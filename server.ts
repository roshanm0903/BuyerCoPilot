import express from 'express';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import path from 'path';
import { getDb, runQuery, runExecute, runTransaction, queryTraceStorage } from './server/db';
import { 
  SOURCING_SYSTEM_PROMPT, 
  buildDocumentParsingPrompt, 
  buildVendorFollowUpEmailPrompt,
  buildTextToDataQueryPrompt 
} from './server/prompts';
import { processAndNormalizeQuote, normalizePriceAndUom } from './server/processors/quoteNormalization';
import { generateRfqWorkbookBuffer } from './server/utils/rfqExcelGenerator';
import { routeCopilotMessage } from './server/utils/copilotRouter';
import { buildSupplierFitAnswer } from './server/utils/supplierFit';
import { prepareDemandConsolidation, DEMO_RFQ_ID, DEMO_PR_NUMBERS } from './server/utils/demandConsolidation';
import { resolveDispatchRecipients, type ShortlistHistoryEntry } from './server/utils/dispatchRecipients';
import { interpretSupplierSelection, filterSupplierSelection } from './server/utils/supplierSelection';
import { evaluateQuoteCompleteness } from './server/utils/quoteCompleteness';
import { answerAwardQuestion, loadAwardContext, type AwardPlan } from './server/utils/awardAnalysis';
import { prepareQuoteFile } from './server/utils/quoteFile';
import { assessRfqCommercialValue, RFQ_COMMERCIAL_REVIEW_THRESHOLD_PERCENT } from './server/utils/rfqCommercialReview';
import { 
  fetchProcurementEvidenceSnapshot, 
  buildDeterministicCopilotAnswer,
  formatInr
} from './server/utils/procurementEvidence';

dotenv.config({ path: '.env.local' });
dotenv.config();

const app = express();
const port = 3000;

app.use(express.json({ limit: '20mb' }));

// Initialize Google GenAI client if GEMINI_API_KEY is available
let ai: GoogleGenAI | null = null;
if (process.env.GEMINI_API_KEY) {
  ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

// -------------------------------------------------------------
// Schema Allowlists for Table and Column Level Query Security
// -------------------------------------------------------------
const SCHEMA_ALLOWLIST: Record<string, { primaryKey: string; columns: string[] }> = {
  factories: {
    primaryKey: 'factory_id',
    columns: ['factory_id', 'name', 'city', 'address', 'active'],
  },
  suppliers: {
    primaryKey: 'supplier_id',
    columns: ['supplier_id', 'name', 'code', 'supplier_type', 'status', 'default_currency'],
  },
  items: {
    primaryKey: 'item_id',
    columns: ['item_id', 'sku_code', 'item_name', 'category', 'size_specification', 'weight_or_gsm', 'uom', 'shape', 'volume_ml', 'carton_format', 'active'],
  },
  item_specifications: {
    primaryKey: 'spec_id',
    columns: ['spec_id', 'item_id', 'version', 'bottle_weight_g', 'food_grade_requirement', 'neck_finish', 'carton_ply', 'board_weight_g', 'quality_criteria', 'status'],
  },
  purchase_requests: {
    primaryKey: 'pr_id',
    columns: ['pr_id', 'pr_number', 'factory_id', 'request_date', 'required_by_date', 'status', 'requester', 'cost_center', 'estimated_budget'],
  },
  purchase_request_lines: {
    primaryKey: 'line_id',
    columns: ['line_id', 'pr_id', 'item_id', 'sku_code', 'item_name', 'category', 'size_specification', 'weight_or_gsm', 'quantity', 'uom', 'baseline_rate', 'estimated_spend'],
  },
  rfxs: {
    primaryKey: 'rfx_id',
    columns: ['rfx_id', 'title', 'issue_date', 'due_date', 'currency', 'buyer_name', 'status'],
  },
  rfx_lines: {
    primaryKey: 'rfx_line_id',
    columns: ['rfx_line_id', 'rfx_id', 'item_id', 'sku_code', 'item_name', 'category', 'size_specification', 'weight_or_gsm', 'quantity_blr', 'quantity_chn', 'total_quantity', 'uom', 'baseline_rate', 'estimated_spend'],
  },
  attachments: {
    primaryKey: 'attachment_id',
    columns: ['attachment_id', 'message_id', 'filename', 'mime_type', 'document_type', 'processed_at', 'file_size_bytes', 'file_content'],
  },
  quotes: {
    primaryKey: 'quote_id',
    columns: ['quote_id', 'rfx_id', 'supplier_id', 'message_id', 'quote_number', 'quote_date', 'currency', 'stated_total_amount', 'calculated_total_amount', 'amount_variance', 'valid_until', 'payment_terms_days', 'freight_treatment', 'status'],
  },
  quote_lines: {
    primaryKey: 'quote_line_id',
    columns: ['quote_line_id', 'quote_id', 'rfx_line_id', 'item_id', 'item_name', 'raw_item_description', 'quoted_quantity', 'quoted_uom', 'unit_price', 'price_uom', 'normalized_unit_price', 'normalized_uom', 'line_total_amount', 'moq_quantity', 'moq_uom', 'lead_time_days', 'delivery_date', 'specification_status'],
  },
  quote_delivery_costs: {
    primaryKey: 'delivery_cost_id',
    columns: ['delivery_cost_id', 'quote_id', 'quote_line_id', 'factory_id', 'treatment', 'amount', 'currency', 'basis', 'allocation_method'],
  },
  field_assessments: {
    primaryKey: 'assessment_id',
    columns: ['assessment_id', 'quote_id', 'quote_line_id', 'field_name', 'raw_value', 'normalized_value', 'status', 'reason', 'evidence_snippet', 'buyer_override', 'updated_at'],
  },
  supplier_performance: {
    primaryKey: 'performance_id',
    columns: ['performance_id', 'supplier_id', 'category', 'period_start', 'period_end', 'received_deliveries', 'on_time_deliveries', 'otif_pct', 'rejection_rate_pct', 'notes'],
  },
  quote_conversations: {
    primaryKey: 'conversation_id',
    columns: ['conversation_id', 'quote_id', 'sender', 'sender_name', 'timestamp', 'subject', 'message_text', 'action_type', 'delivery_status'],
  },
  rfq_messages: {
    primaryKey: 'message_id',
    columns: ['message_id', 'rfx_id', 'supplier_id', 'subject', 'message_text', 'delivery_status', 'created_at', 'sent_at', 'provider_message_id'],
  },
  sourcing_scenarios: {
    primaryKey: 'scenario_id',
    columns: ['scenario_id', 'name', 'tagline', 'is_recommended', 'primary_supplier_id', 'primary_supplier_name', 'primary_share_percent', 'secondary_supplier_id', 'secondary_supplier_name', 'secondary_share_percent', 'total_spend', 'baseline_spend', 'savings', 'savings_percent', 'resilience_score', 'notes_json'],
  },
  supplier_categories: {
    primaryKey: 'id',
    columns: ['id', 'supplier_id', 'category', 'is_primary', 'qualification_status', 'monthly_capacity_units', 'lead_time_days', 'certified_standards', 'active'],
  },
  supplier_products: {
    primaryKey: 'id',
    columns: ['id', 'supplier_id', 'category', 'product_family', 'sku_pattern', 'active', 'qualification_status', 'is_primary', 'monthly_capacity_units', 'lead_time_days', 'certified_standards'],
  },
};

const ALLOWED_TABLES = Object.keys(SCHEMA_ALLOWLIST);

async function loadRfqWorkbookLines(rfqId = DEMO_RFQ_ID) {
  return runQuery(`
    SELECT i.sku_code, i.item_name, i.category, i.size_specification, i.weight_or_gsm,
           l.quantity_blr, l.quantity_chn, l.total_quantity, i.uom, l.baseline_rate
    FROM rfx_lines l JOIN items i ON i.item_id = l.item_id
    WHERE l.rfx_id = ? ORDER BY i.category, i.sku_code;
  `, [rfqId]);
}

// Helper to translate questions into explicit data queries using server/prompts/textToDataQueryPrompt.ts
function generateDataQuery(message: string, context?: string) {
  const lower = message.toLowerCase();

  // If the user's intent is document download, exporting, file creation, or non-data conversation:
  // Return null because no database SQL query is needed!
  if (
    lower.includes('download') || 
    lower.includes('excel') || 
    lower.includes('export') || 
    lower.includes('can i download') || 
    lower.includes('create an excel') || 
    lower.includes('file') || 
    lower.includes('document')
  ) {
    return null;
  }

  // 0. Supplier Catalog Mapping Architecture Query (Where stored? How filtered? One vendor multiple products?)
  if (
    lower.includes('where will that be stored') ||
    lower.includes('where is that stored') ||
    lower.includes('where is it stored') ||
    lower.includes('how will they all be filtered') ||
    lower.includes('how are they filtered') ||
    lower.includes('matching aspect') ||
    lower.includes('mapping table') ||
    lower.includes('one vendor') ||
    lower.includes('multiple products') ||
    lower.includes('100s') ||
    lower.includes('supplier_products') ||
    lower.includes('supplier_categories')
  ) {
    return {
      sql: `SELECT 
  s.supplier_id,
  s.name,
  s.code,
  sc.category,
  sprod.product_family,
  sprod.sku_pattern,
  sc.is_primary,
  sc.qualification_status,
  sc.monthly_capacity_units,
  sc.lead_time_days,
  sc.certified_standards
FROM suppliers s
JOIN supplier_categories sc ON s.supplier_id = sc.supplier_id
LEFT JOIN supplier_products sprod ON s.supplier_id = sprod.supplier_id AND sc.category = sprod.category
WHERE s.status = 'active'
ORDER BY s.supplier_id ASC, sc.is_primary DESC;`,
      targetEntity: 'supplier_products & supplier_categories (Relational Mapping Tables)',
      filterExplanation: 'Pre-existing 1-to-many mapping tables linking suppliers to certified product categories and SKU patterns. One vendor has multiple rows when supplying multiple products.',
      recordsRetrieved: 20,
      promptFile: 'server/prompts/textToDataQueryPrompt.ts',
    };
  }

  // 1. Multi-product capability query (Suppliers that supply both bottles and cartons)
  if (
    lower.includes('both') || 
    lower.includes('multi') || 
    (lower.includes('bottles') && lower.includes('cartons'))
  ) {
    return {
      sql: `SELECT 
  s.supplier_id, 
  s.name, 
  s.code, 
  s.supplier_type, 
  GROUP_CONCAT(DISTINCT sc.category) AS matched_categories,
  COUNT(DISTINCT sc.category) AS categories_covered_count,
  sp.received_deliveries, 
  sp.on_time_deliveries, 
  sp.otif_pct
FROM suppliers s
JOIN supplier_categories sc ON s.supplier_id = sc.supplier_id
JOIN supplier_performance sp ON s.supplier_id = sp.supplier_id
WHERE sc.category IN (SELECT DISTINCT i.category FROM rfx_lines l JOIN items i ON i.item_id = l.item_id WHERE l.rfx_id = 'RFQ-2026-041')
  AND sc.qualification_status = 'approved'
  AND s.status = 'active'
GROUP BY s.supplier_id
HAVING categories_covered_count > 1
ORDER BY sp.otif_pct DESC;`,
      targetEntity: 'suppliers JOIN supplier_categories (Multi-Category Scope Match)',
      filterExplanation: 'Filter vendors in supplier_categories whose approved capabilities cover multiple RFQ categories (both PET Bottles and Cartons).',
      recordsRetrieved: 3,
      promptFile: 'server/prompts/textToDataQueryPrompt.ts',
    };
  }

  // 2. Delivery Reliability Filter with Scope Matching (OTIF >= 95.0% / Vendor Performance / Missed Deliveries)
  if (
    lower.includes('95') ||
    lower.includes('performance') ||
    lower.includes('otif') ||
    lower.includes('not missed') || 
    lower.includes('missed delivery') || 
    lower.includes('missed') || 
    lower.includes('reliable') || 
    lower.includes('delivery date') ||
    lower.includes('delivery reliability') ||
    lower.includes('at least')
  ) {
    return {
      sql: `SELECT 
  s.supplier_id, 
  s.name, 
  s.code, 
  s.supplier_type, 
  GROUP_CONCAT(DISTINCT sc.category) AS matched_categories,
  sp.received_deliveries, 
  sp.on_time_deliveries, 
  (sp.received_deliveries - sp.on_time_deliveries) AS missed_deliveries,
  sp.otif_pct, 
  sp.rejection_rate_pct
FROM suppliers s
JOIN supplier_categories sc ON s.supplier_id = sc.supplier_id
JOIN supplier_performance sp ON s.supplier_id = sp.supplier_id
WHERE sc.category IN (SELECT DISTINCT i.category FROM rfx_lines l JOIN items i ON i.item_id = l.item_id WHERE l.rfx_id = 'RFQ-2026-041')
  AND sc.qualification_status = 'approved'
  AND s.status = 'active'
  AND sp.otif_pct >= 95.0
GROUP BY s.supplier_id
ORDER BY sp.otif_pct DESC;`,
      targetEntity: 'suppliers JOIN supplier_categories JOIN supplier_performance',
      filterExplanation: 'Match suppliers to RFQ-2026-041 required categories (PET Bottles, Cartons) via supplier_categories, filtering on active status and OTIF >= 95.0%. Excludes suppliers of other commodities (Labels, Glass, Tin Cans, etc.).',
      recordsRetrieved: 7,
      promptFile: 'server/prompts/textToDataQueryPrompt.ts',
    };
  }

  // 3. General Vendor List / RFQ Matching Suppliers Discovery
  if (
    lower.includes('match') ||
    lower.includes('vendor') || 
    lower.includes('supplier') || 
    lower.includes('who are the') || 
    lower.includes('list of')
  ) {
    return {
      sql: `SELECT 
  s.supplier_id, 
  s.name, 
  s.code, 
  s.supplier_type, 
  GROUP_CONCAT(DISTINCT sc.category) AS matched_categories,
  COUNT(DISTINCT sc.category) AS categories_count,
  sp.received_deliveries, 
  sp.on_time_deliveries, 
  sp.otif_pct
FROM suppliers s
JOIN supplier_categories sc ON s.supplier_id = sc.supplier_id
LEFT JOIN supplier_performance sp ON s.supplier_id = sp.supplier_id
WHERE sc.category IN (SELECT DISTINCT i.category FROM rfx_lines l JOIN items i ON i.item_id = l.item_id WHERE l.rfx_id = 'RFQ-2026-041')
  AND sc.qualification_status = 'approved'
  AND s.status = 'active'
GROUP BY s.supplier_id
ORDER BY categories_count DESC, sp.otif_pct DESC;`,
      targetEntity: 'suppliers JOIN supplier_categories (RFQ Product Matching)',
      filterExplanation: 'Filter database suppliers matching RFQ-2026-041 product categories (PET Bottles, Cartons) from supplier_categories master mapping table.',
      recordsRetrieved: 8,
      promptFile: 'server/prompts/textToDataQueryPrompt.ts',
    };
  }

  // 3. Multi-Plant Demand Consolidation
  if (
    lower.includes('consolidat') || 
    lower.includes('all lines') || 
    lower.includes('demand matrix') || 
    lower.includes('total volume') || 
    lower.includes('consolidated list') ||
    lower.includes('pr-blr') ||
    lower.includes('pr-chn')
  ) {
    return {
      sql: `SELECT 
  sku_code, 
  item_name, 
  category, 
  size_specification, 
  quantity_blr,
  quantity_chn,
  total_quantity,
  baseline_rate,
  estimated_spend
FROM rfx_lines
ORDER BY category, sku_code;`,
      targetEntity: 'rfx_lines (Multi-Plant Demand Matrix)',
      filterExplanation: 'Consolidating line-item requirements across PR-BLR-1088 (Bengaluru) and PR-CHN-1045 (Chennai) grouped by SKU.',
      recordsRetrieved: 30,
      promptFile: 'server/prompts/textToDataQueryPrompt.ts',
      isConsolidation: true,
    };
  }

  // 4. Baseline Budget & Requisition Spend
  if (lower.includes('budget') || lower.includes('cost') || lower.includes('spend') || lower.includes('baseline')) {
    return {
      sql: `SELECT pr.pr_number, f.name as factory_name, pr.estimated_budget, COUNT(l.line_id) as total_lines 
FROM purchase_requests pr 
LEFT JOIN factories f ON pr.factory_id = f.factory_id
LEFT JOIN purchase_request_lines l ON pr.pr_id = l.pr_id 
GROUP BY pr.pr_number;`,
      targetEntity: 'purchase_requests & purchase_request_lines',
      filterExplanation: 'Analyzing active plant requisition volume and baseline spend in scope for RFQ-2026-041.',
      recordsRetrieved: 2,
      promptFile: 'server/prompts/textToDataQueryPrompt.ts',
    };
  }

  return null;
}

// -------------------------------------------------------------
// Sourcing Copilot Chat Endpoint Grounded in Dynamic Evidence
// -------------------------------------------------------------
app.use('/api/copilot/chat', (_req, res, next) => {
  const trace = { queries: [] as import('./server/db').ExecutedQuery[] };
  const sendJson = res.json.bind(res);
  res.json = ((body: unknown) => sendJson(
    body && typeof body === 'object' && !Array.isArray(body)
      ? { ...body, executedQueries: trace.queries }
      : body
  )) as typeof res.json;
  queryTraceStorage.run(trace, next);
});

app.post('/api/copilot/chat', async (req, res) => {
  const { message, history, context } = req.body;

  if (typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'Message is required' });
  }

  let routing;
  try {
    routing = await routeCopilotMessage(
      ai,
      message,
      Array.isArray(history) ? history : [],
      typeof context === 'string' ? context : '',
    );
  } catch (err: unknown) {
    console.warn('Gemini chat routing unavailable:', (err as Error)?.message || err);
    return res.status(503).json({ error: 'Gemini routing is unavailable. Please retry the chat request.', code: 'ROUTING_UNAVAILABLE' });
  }
  const { route } = routing;
  const routingTrace = {
    step: 1,
    phase: 'LLM Intent Routing',
    tool: 'gemini_route_chat_intent',
    input: { workspace: context || 'ALL' },
    output: { route, analysis_kind: routing.analysisKind, model: routing.model },
    latencyMs: routing.latencyMs,
    status: 'completed' as const,
  };

  if (route === 'greeting' || route === 'help') {
    return res.json({
      reply: route === 'greeting'
        ? 'Hi! I can help you review purchase requests, find matching suppliers, compare quotes, and prepare an award. What would you like to work on?'
        : 'I can review demand and budgets, find qualified suppliers, explain quote exceptions, compare award scenarios, or prepare an RFQ workbook. Ask about a specific record or choose a task.',
      route,
      model: 'app-guidance',
      liveLLM: false,
      deterministicAnswer: false,
      executionTrace: [routingTrace],
      dataQuery: null,
    });
  }

  if (route === 'demand_consolidation') {
    const mentionedPrs = message.match(/\bPR-[A-Z0-9-]+\b/gi)?.map((id) => id.toUpperCase()) || [];
    if (mentionedPrs.some((id) => !DEMO_PR_NUMBERS.includes(id as typeof DEMO_PR_NUMBERS[number]))) {
      return res.status(400).json({ error: 'This demo RFQ is linked to PR-BLR-1088 and PR-CHN-1045. Please select those purchase requests.' });
    }
    try {
      const started = Date.now();
      const result = await prepareDemandConsolidation();
      const workbook = generateRfqWorkbookBuffer(await loadRfqWorkbookLines(result.rfqId));
      const number = (value: number) => new Intl.NumberFormat('en-IN').format(value);
      const prRows = result.prs.map((pr) => `| \`${pr.pr_number}\` | ${pr.factory_id === 'BLR' ? 'Bengaluru' : 'Chennai'} | ${number(pr.quantity)} | ${formatInr(pr.baseline)} | ${pr.required_by_date} |`).join('\n');
      const categoryRows = result.categories.map((category) => `| ${category.category} | ${category.skus} | ${number(category.quantity)} |`).join('\n');
      return res.json({
        reply: `### Demand consolidated into ${result.rfqId}\n\n${result.created ? 'The RFQ has been created' : 'The RFQ is already created'} from the two approved purchase requests. Its Excel workbook is ready to download.\n\n| Purchase request | Delivery plant | Quantity (EA) | Baseline | Required by |\n|---|---|---:|---:|---|\n${prRows}\n\n| Category | Items | Combined quantity (EA) |\n|---|---:|---:|\n${categoryRows}\n\n**Total:** ${result.lines.length} items, ${number(result.totalQuantity)} EA, baseline ${formatInr(result.baseline)}.\n\nThe workbook includes the combined item schedule with separate Bengaluru and Chennai quantities.`,
        route, model: 'sqlite-demand-consolidation', liveLLM: false, deterministicAnswer: true,
        executionTrace: [routingTrace, { step: 2, phase: 'PR Demand Consolidation and RFQ Workbook',
          tool: 'sqlite_reconcile_prs_and_generate_rfq_excel',
          input: { purchase_requests: DEMO_PR_NUMBERS },
          output: { rfq_id: result.rfqId, created: result.created, items: result.lines.length, bytes: workbook.length },
          latencyMs: Math.max(1, Date.now() - started), status: 'completed' }],
        dataQuery: null, isConsolidatedDemand: true, isExcelDownloadReady: true,
        excelDownloadUrl: '/api/rfq/excel', excelFilename: 'A2B_Packaging_RFQ_2026_041.xlsx',
      });
    } catch (error) {
      console.error('Demand consolidation failed:', error);
      return res.status(409).json({ error: String((error as Error).message || error) });
    }
  }

  if (route === 'supplier_list') {
    const started = Date.now();
    const suppliers = await runQuery(`
      SELECT s.supplier_id, s.name, s.status, s.supplier_type,
             GROUP_CONCAT(DISTINCT sc.category) AS categories
      FROM suppliers s
      LEFT JOIN supplier_categories sc ON sc.supplier_id = s.supplier_id
      GROUP BY s.supplier_id
      ORDER BY s.name;
    `);
    const rows = suppliers.map((supplier: any) =>
      `| ${supplier.name} | ${supplier.supplier_id} | ${supplier.categories || 'Not recorded'} | ${supplier.status} |`
    ).join('\n');
    return res.json({
      reply: `### All suppliers (${suppliers.length})\n\nThis is the full supplier master. No PR, RFQ, category, qualification, or performance filter has been applied.\n\n| Supplier | ID | Registered categories | Status |\n|---|---|---|---|\n${rows}`,
      route,
      model: 'sqlite-deterministic-engine',
      liveLLM: false,
      deterministicAnswer: true,
      executionTrace: [routingTrace, {
        step: 2,
        phase: 'Supplier Master Retrieval',
        tool: 'sqlite_list_all_suppliers',
        input: { table: 'suppliers', filters: [] },
        output: { records_retrieved: suppliers.length },
        latencyMs: Math.max(1, Date.now() - started),
        status: 'completed',
      }],
      dataQuery: null,
    });
  }

  if (route === 'rfq_dispatch' || route === 'supplier_selection') {
    const turns: ShortlistHistoryEntry[] = Array.isArray(history) ? history : [];
    const shortlistIndex = turns.map((turn) => turn.sender === 'assistant' && Array.isArray(turn.supplierShortlist?.supplierIds)).lastIndexOf(true);
    if (shortlistIndex < 0) {
      return res.json({
        reply: 'I need a supplier shortlist first. Ask me which suppliers can meet the PR demand, then tell me which to include.',
        route, model: 'app-guidance', liveLLM: false, deterministicAnswer: false,
        executionTrace: [routingTrace], dataQuery: null,
      });
    }

    const priorShortlist = turns[shortlistIndex].supplierShortlist!;
    const currentFit = await buildSupplierFitAnswer();
    const eligibleIds = [...new Set((priorShortlist.candidateIds || priorShortlist.supplierIds).filter((id) => currentFit.candidateSupplierIds.includes(id)))];
    const selectedIds = priorShortlist.supplierIds.filter((id) => eligibleIds.includes(id));
    if (!eligibleIds.length) {
      return res.json({
        reply: 'The earlier shortlist has no suppliers that still pass the current screening. Please refresh the supplier fit before preparing an RFQ.',
        route, model: 'sqlite-supplier-fit-engine', liveLLM: false, deterministicAnswer: true,
        executionTrace: [routingTrace], dataQuery: null,
      });
    }

    let recipientIds: string[];
    const started = Date.now();
    const candidatePlaceholders = eligibleIds.map(() => '?').join(', ');
    const eligibleSuppliers = await runQuery(`SELECT supplier_id, name FROM suppliers WHERE supplier_id IN (${candidatePlaceholders});`, eligibleIds);
    if (route === 'supplier_selection') {
      try {
        const intent = await interpretSupplierSelection(ai, message);
        if (intent.action === 'filter') {
          const matched = await filterSupplierSelection(selectedIds, intent);
          const filteredIds = matched.map((supplier) => supplier.supplier_id);
          const fitById = new Map(currentFit.supplierResults.map((supplier) => [supplier.id, supplier]));
          const rows = matched.map((supplier) => {
            const fit = fitById.get(supplier.supplier_id);
            return `| ${supplier.name} (\`${supplier.supplier_id}\`) | ${supplier.otif_pct.toFixed(1)}% | ${fit?.result || 'Needs review'} | ${(fit?.gaps || '—').replace(/\|/g, '\\|')} |`;
          }).join('\n');
          return res.json({
            reply: `### Supplier shortlist (${matched.length})\n\nApplied your ${intent.metric === 'otif_pct' ? 'on-time performance (OTIF)' : 'rejection rate'} filter to the ${selectedIds.length} suppliers in the current selection.\n\n${matched.length ? `| Supplier | OTIF | Demand fit | Gaps / checks |\n|---|---:|---|---|\n${rows}` : 'No suppliers in the current selection meet this threshold.'}\n\nHistorical OTIF is not a delivery commitment. Review the demand-fit gaps before inviting or awarding suppliers.`,
            route, model: 'gemini-filter-interpreter + sqlite', liveLLM: true, deterministicAnswer: true,
            executionTrace: [routingTrace, { step: 2, phase: 'Supplier Filter Interpretation', tool: 'gemini_interpret_supplier_filter',
              input: { message }, output: intent, latencyMs: Math.max(1, Date.now() - started), status: 'completed' }],
            dataQuery: null, supplierShortlist: { supplierIds: filteredIds, candidateIds: eligibleIds },
          });
        }
      } catch (err: unknown) {
        console.warn('Supplier selection interpretation failed:', (err as Error)?.message || err);
        return res.status(503).json({ error: 'I could not interpret that supplier filter. Please retry.', code: 'SUPPLIER_FILTER_UNAVAILABLE' });
      }
    }
    try {
      recipientIds = await resolveDispatchRecipients(ai, message, turns.slice(shortlistIndex + 1), eligibleIds, selectedIds, eligibleSuppliers);
    } catch (err: unknown) {
      console.warn('RFQ recipient resolution failed:', (err as Error)?.message || err);
      return res.status(503).json({ error: 'I could not verify the intended RFQ recipients. Please retry.', code: 'RECIPIENT_RESOLUTION_UNAVAILABLE' });
    }
    if (!recipientIds.length) {
      return res.json({
        reply: 'I could not identify a definite recipient set from the conversation. Please name the suppliers to include.',
        route, model: 'gemini-3.1-flash-lite', liveLLM: true, deterministicAnswer: false,
        executionTrace: [routingTrace], dataQuery: null,
      });
    }

    const placeholders = recipientIds.map(() => '?').join(', ');
    const recipients = await runQuery(`SELECT supplier_id, name FROM suppliers WHERE supplier_id IN (${placeholders}) ORDER BY name;`, recipientIds);
    const recipientTable = recipients.map((supplier: { supplier_id: string; name: string }) => `| ${supplier.name} | ${supplier.supplier_id} |`).join('\n');
    const isDispatchRequest = route === 'rfq_dispatch';
    if (isDispatchRequest) {
      const rfxRows = await runQuery('SELECT rfx_id, title FROM rfxs ORDER BY rfx_id LIMIT 1;');
      const rfx = rfxRows[0];
      if (!rfx) return res.status(404).json({ error: 'No RFQ is available for the selected suppliers.' });
      const createdAt = new Date().toISOString();
      await runTransaction((db) => {
        db.run(`UPDATE rfq_messages SET delivery_status = 'cancelled'
          WHERE rfx_id = ? AND delivery_status = 'draft' AND supplier_id NOT IN (${placeholders});`, [rfx.rfx_id, ...recipientIds]);
        for (const supplier of recipients) {
          db.run(`INSERT INTO rfq_messages
            (message_id, rfx_id, supplier_id, subject, message_text, delivery_status, created_at)
            VALUES (?, ?, ?, ?, ?, 'draft', ?)
            ON CONFLICT(rfx_id, supplier_id) DO UPDATE SET
              subject = excluded.subject, message_text = excluded.message_text,
              delivery_status = 'draft', created_at = excluded.created_at
            WHERE rfq_messages.delivery_status IN ('draft', 'cancelled');`, [
            `RFQMSG-${rfx.rfx_id}-${supplier.supplier_id}`, rfx.rfx_id, supplier.supplier_id,
            `Invitation to quote: ${rfx.title} (${rfx.rfx_id})`,
            `Dear ${supplier.name} Team,\n\nWe invite you to provide a quotation for ${rfx.title} (${rfx.rfx_id}). Please review the RFQ details and share your pricing, delivery lead time, and commercial terms for the items you can supply.\n\nKind regards,\nSourcing Team`,
            createdAt,
          ]);
        }
      });
    }
    return res.json({
      reply: `### ${isDispatchRequest ? 'RFQ invitation drafts saved' : 'Supplier shortlist updated'} (${recipients.length})\n\n| Supplier | ID |\n|---|---|\n${recipientTable}\n\n${isDispatchRequest ? '**No email was sent** because email delivery is not configured. Drafts will appear in Supplier Inbox only after delivery is recorded.' : 'I will use this selection for your next instruction.'}`,
      route, model: 'gemini-recipient-resolver', liveLLM: true, deterministicAnswer: false,
      executionTrace: [routingTrace, {
        step: 2, phase: 'RFQ Recipient Resolution', tool: 'gemini_resolve_dispatch_recipients',
        input: { shortlisted_supplier_ids: eligibleIds }, output: { recipient_ids: recipientIds },
        latencyMs: Math.max(1, Date.now() - started), status: 'completed',
      }],
      dataQuery: null,
      supplierShortlist: { supplierIds: recipientIds, candidateIds: eligibleIds },
    });
  }

  if (route === 'supplier_fit') {
    const started = Date.now();
    const result = await buildSupplierFitAnswer();
    return res.json({
      reply: result.reply,
      route,
      model: 'sqlite-supplier-fit-engine',
      liveLLM: false,
      deterministicAnswer: true,
      executionTrace: [routingTrace, {
        step: 2,
        phase: 'Supplier Demand Fit Screening',
        tool: 'sqlite_screen_supplier_fit',
        input: { scope: 'approved_purchase_requests', checks: ['SKU coverage', 'monthly capacity', 'lead time', 'OTIF'] },
        output: { suppliers_screened: result.suppliersScreened, demand_categories: result.demandCategories },
        latencyMs: Math.max(1, Date.now() - started),
        status: 'completed',
      }],
      dataQuery: null,
      supplierShortlist: { supplierIds: result.candidateSupplierIds, candidateIds: result.candidateSupplierIds },
    });
  }

  if (route === 'general') {
    if (ai) {
      try {
        const started = Date.now();
        const response = await ai.models.generateContent({
          model: 'gemini-3.1-flash-lite',
          contents: `You are a concise procurement assistant. Answer the user's general question conversationally. Do not claim to have inspected records, run tools, sent messages, or completed actions. If they need current sourcing facts, ask them to name the record or procurement question.\n\nUser: ${message}`,
        });
        if (response.text) {
          return res.json({ reply: response.text, route, model: 'gemini-3.1-flash-lite', liveLLM: true, deterministicAnswer: false, executionTrace: [routingTrace, {
            step: 2,
            phase: 'General Response Generation',
            tool: 'gemini_generate_response',
            input: { route },
            output: { model: 'gemini-3.1-flash-lite' },
            latencyMs: Math.max(1, Date.now() - started),
            status: 'completed',
          }], dataQuery: null });
        }
      } catch (err: unknown) {
        console.warn('General chat model error:', (err as Error)?.message || err);
      }
    }
    return res.json({
      reply: 'I can help with purchase requests, suppliers, quotes, RFQs, and award decisions. What would you like to review?',
      route,
      model: 'app-guidance',
      liveLLM: false,
      deterministicAnswer: false,
      executionTrace: [routingTrace],
      dataQuery: null,
    });
  }

  // 1. Measure and retrieve live procurement evidence from SQLite database
  const tDbStart = Date.now();
  const recentRfx = [message, ...(Array.isArray(history) ? [...history].reverse().map((entry: { text?: string }) => entry.text || '') : [])]
    .map((text) => text.match(/\bRFQ-[A-Z0-9-]+\b/i)?.[0].toUpperCase()).find(Boolean);
  const [defaultRfx] = recentRfx ? [] : await runQuery('SELECT rfx_id FROM rfxs ORDER BY issue_date DESC, rfx_id DESC LIMIT 1;');
  const selectedRfxId = recentRfx || defaultRfx?.rfx_id;
  if (!selectedRfxId) return res.status(404).json({ error: 'No RFQ is available for this analysis.' });
  const evidence = await fetchProcurementEvidenceSnapshot(selectedRfxId);
  const quoteReview = await Promise.all(evidence.quotes.map((quote) => reviewQuoteCompleteness(quote)));
  const dbLatencyMs = Math.max(1, Date.now() - tDbStart);

  const realTrace: any[] = [
    routingTrace,
    {
      step: 2,
      phase: 'Relational Database State Retrieval',
      tool: 'sqlite_fetch_current_records',
      input: { workspace: context || 'ALL', queries: ['items', 'purchase_requests', 'suppliers', 'quotes', 'scenarios', 'field_assessments'] },
      output: { 
        prs_loaded: evidence.purchaseRequests.length, 
        items_loaded: evidence.items.length,
        suppliers_loaded: evidence.suppliers.length, 
        quotes_loaded: evidence.quotes.length,
        quote_reviews_loaded: quoteReview.length,
        assessments_loaded: evidence.fieldAssessments.length,
        lines_total: evidence.sourcingSummary.total_skus,
        snapshot_time: evidence.timestamp
      },
      latencyMs: dbLatencyMs,
      status: 'completed' as const,
    },
  ];

  if (route === 'procurement_data' && routing.analysisKind === 'quote_eligibility') {
    const scopedReviews = quoteReview.filter((quote) => quote.rfx_id === evidence.sourcingSummary.rfx_id);
    realTrace.push({ step: realTrace.length + 1, phase: 'Quote Coverage and Terms Review',
      tool: 'sqlite_review_quote_completeness', input: { rfx_id: evidence.sourcingSummary.rfx_id },
      output: { quotes_reviewed: scopedReviews.length, complete_quotes: scopedReviews.filter((quote) => quote.completeness_status === 'complete').length },
      latencyMs: 1, status: 'completed' });
    return res.json({ reply: buildQuoteReviewReply(evidence.sourcingSummary.rfx_id, scopedReviews),
      route, model: 'sqlite-quote-review', liveLLM: false, deterministicAnswer: true,
      executionTrace: realTrace, dataQuery: null,
      sourceQuoteIds: scopedReviews.map((quote) => quote.quote_id) });
  }

  if (route === 'procurement_data' && routing.analysisKind !== 'other') {
    try {
      const readyIds = quoteReview.filter((quote) => quote.rfx_id === evidence.sourcingSummary.rfx_id && quote.completeness_status === 'complete').map((quote) => quote.quote_id);
      const awardContext = await loadAwardContext(evidence.sourcingSummary.rfx_id, readyIds);
      const previousPlan = Array.isArray(history)
        ? [...history].reverse().find((entry: { awardPlan?: AwardPlan }) => entry.awardPlan)?.awardPlan as AwardPlan | undefined
        : undefined;
      const answer = answerAwardQuestion(awardContext, routing.analysisKind, previousPlan, message);
      if (answer) {
        realTrace.push({ step: realTrace.length + 1, phase: 'Award Quote and Allocation Analysis',
          tool: 'sqlite_calculate_award_options',
          input: { rfx_id: awardContext.rfxId, analysis_kind: routing.analysisKind },
          output: { complete_quote_ids: readyIds, rfq_lines: awardContext.lines.length, allocation_lines: answer.awardPlan?.allocations.length || 0 },
          latencyMs: 1, status: 'completed' });
        return res.json({ ...answer, route, model: 'sqlite-award-analysis', liveLLM: false,
          deterministicAnswer: true, executionTrace: realTrace, dataQuery: null });
      }
    } catch (error) {
      console.error('Award analysis error:', error);
      return res.status(500).json({ error: 'Could not calculate a verified award answer from the current RFQ records.' });
    }
  }

  // SPECIAL HANDLER: RFQ Excel File Creation / Download Request
  if (route === 'rfq_download') {
    const tExcelStart = Date.now();
    const excelBuffer = generateRfqWorkbookBuffer(await loadRfqWorkbookLines());
    const excelLatencyMs = Math.max(1, Date.now() - tExcelStart);

    realTrace.push({
      step: realTrace.length + 1,
      phase: 'OpenXML Workbook Generation',
      tool: 'generate_rfq_excel_packet',
      input: { sheets: ['RFQ_Scope_Overview', 'Line_Items_Schedule', 'Vendor_Questionnaire', 'RFQ_Terms_Conditions'] },
      output: { filename: 'A2B_Packaging_RFQ_2026_041.xlsx', sheets_count: 4, bytes: excelBuffer.length, status: 'READY_TO_DOWNLOAD' },
      latencyMs: excelLatencyMs,
      status: 'completed' as const,
    });

    const s = evidence.sourcingSummary;
    const prNumbers = evidence.purchaseRequests.map(p => p.pr_number).join(' and ');

    return res.json({
      reply: `### 📄 RFQ Excel Specification Packet Generated

I have generated the official multi-sheet Request for Quotation (RFQ) Excel packet for **${s.rfx_id}** consolidating requisitions **${prNumbers}** for the Bengaluru and Chennai delivery locations.

#### 📑 Multi-Sheet Document Structure:
1. **Sheet 1: RFQ_Scope_Overview**
   - Delivery locations, submission deadline (**2026-09-30 17:00 IST**), receiving dock delivery date (**2026-10-25**), aggregated baseline budget (**${formatInr(s.total_baseline_spend)}**), and dual-sourcing guidelines.
2. **Sheet 2: Line_Items_Schedule**
   - Itemized master table containing all **${s.total_skus} distinct SKU lines** (20 PET bottle sizes + 10 carton formats), plant-specific demand breakdown, baseline reference rates, and vendor quotation entry columns (unit rate, make/brand, lead time, and freight).
3. **Sheet 3: Vendor_Questionnaire**
   - **10 mandatory technical and commercial qualification inquiries**: NABL/FSSAI food-contact migration certification, monthly plant capacity, Net 45/60 payment terms, tooling fee waiver, freight structure, and 24h RCA SLA.
4. **Sheet 4: RFQ_Terms_Conditions**
   - Mandatory food safety standards, 95% OTIF delivery SLA (with 1% weekly liquidated damages), ISPM-15 palletization, payment settlement, and confidentiality undertaking.

Click the download button below to retrieve your live Excel workbook:`,
      model: 'openxml-excel-engine',
      route,
      liveLLM: false,
      deterministicAnswer: true,
      executionTrace: realTrace,
      dataQuery: null,
      isExcelDownloadReady: true,
      excelDownloadUrl: '/api/rfq/excel',
      excelFilename: 'A2B_Packaging_RFQ_2026_041.xlsx',
    });
  }

  // 2. Generate and verify real Data Query if analytical question
  const asksAboutQuotes = /\b(quotes?|quotations?|bids?)\b/i.test(message);
  const asksAboutQuoteCompleteness = asksAboutQuotes && /\b(complete|completeness|coverage|all\s+\d+|missing)\b/i.test(message);
  const dataQuery = asksAboutQuotes ? null : generateDataQuery(message, context);
  if (asksAboutQuotes) {
    realTrace.push({
      step: realTrace.length + 1,
      phase: 'Quote Coverage and Terms Review',
      tool: 'sqlite_review_quote_completeness',
      input: { rfx_id: evidence.sourcingSummary.rfx_id, checks: ['RFQ line coverage', 'supplier qualification', 'required fields', 'assessments'] },
      output: { quotes_reviewed: quoteReview.length, complete_quotes: quoteReview.filter((quote) => quote.completeness_status === 'complete').length },
      latencyMs: 1,
      status: 'completed' as const,
    });
  }
  if (dataQuery) {
    const tQueryStart = Date.now();
    try {
      const qRows = await runQuery(dataQuery.sql);
      dataQuery.recordsRetrieved = qRows.length;
    } catch (e) {
      console.warn('Real query execution warning:', e);
    }
    const queryLatencyMs = Math.max(1, Date.now() - tQueryStart);

    realTrace.push({
      step: realTrace.length + 1,
      phase: 'Dynamic Data Query Translation & Execution',
      tool: 'sqlite_execute_data_query',
      input: { target_entity: dataQuery.targetEntity, filter: dataQuery.filterExplanation },
      output: { records_matched: dataQuery.recordsRetrieved, prompt_template: dataQuery.promptFile },
      latencyMs: queryLatencyMs,
      status: 'completed' as const,
    });
  }

  // 3. Attempt Gemini LLM Call with Dynamic Structured Evidence Snapshot
  if (ai) {
    const candidateModels = ['gemini-3.1-flash-lite', 'gemini-flash-latest', 'gemini-3.8-flash'];
    for (const modelName of candidateModels) {
      try {
        const formattedHistory = Array.isArray(history)
          ? history
              .slice(-6)
              .map((h: { sender: string; text: string }) => `${h.sender === 'user' ? 'User' : 'Assistant'}: ${h.text}`)
              .join('\n')
          : '';

        const scopedEvidence = { ...evidence, quoteReview };

        const evidencePrompt = `
${SOURCING_SYSTEM_PROMPT}

Current Procurement Evidence Snapshot (As of ${evidence.timestamp}):
\`\`\`json
${JSON.stringify(scopedEvidence, null, 2)}
\`\`\`

Active Workspace Context: ${context || 'General Sourcing'}
Conversation History:
${formattedHistory}

User Inquiry:
"${message}"

Instructions:
- Base your response strictly on the structured evidence provided above.
- Use conversation history only to resolve references. Earlier assistant replies may be stale or wrong; current database evidence takes precedence.
- For quote completeness questions, use quoteReview.completeness_status and its field and category issues. Do not infer completeness from supplier performance or RFQ status.
- Distinguish recorded sample quotes from externally verified supplier submissions. Do not claim certification documents have been verified unless present in evidence.
- Format INR monetary amounts in full with exactly two decimal places; do not abbreviate as k, L, Lakhs, or Cr.
- Cite specific record IDs (e.g. PR-xxx, SUP-xxx).
- If information is missing from the evidence snapshot, state clearly that it is not present in database records.
- Present two or more comparable records or items as a Markdown table with useful columns. Put caveats below the table.
- Provide a clear, professional, markdown-formatted response.
`.trim();

        const tGeminiStart = Date.now();
        const response = await ai.models.generateContent({
          model: modelName,
          contents: evidencePrompt,
        });
        const geminiLatencyMs = Date.now() - tGeminiStart;

        if (response.text) {
          const completeQuoteIds = quoteReview.filter((quote) => quote.completeness_status === 'complete').map((quote) => quote.quote_id);
          if (asksAboutQuoteCompleteness && completeQuoteIds.some((id) => !response.text!.includes(id))) {
            console.warn('Gemini quote answer omitted complete quote records; using verified quote review instead.');
            break;
          }
          realTrace.push({
            step: realTrace.length + 1,
            phase: 'Gemini Autonomous Sourcing Synthesis',
            tool: 'gemini_generate_content',
            input: { model: modelName, evidence_source: 'live_sqlite_snapshot' },
            output: { status: 'completed', response_bytes: response.text.length },
            latencyMs: geminiLatencyMs,
            status: 'completed' as const,
          });

          return res.json({ 
            reply: response.text, 
            model: modelName, 
            route,
            liveLLM: true,
            deterministicAnswer: false,
            executionTrace: realTrace,
            dataQuery,
            isConsolidatedDemand: dataQuery?.isConsolidation || false,
          });
        }
      } catch (err: unknown) {
        console.warn(`Model ${modelName} error:`, (err as Error)?.message || err);
      }
    }
  }

  // 4. Honest Deterministic Fallback Computed Directly from Current SQLite Evidence
  const tDetStart = Date.now();
  const deterministicReply = asksAboutQuoteCompleteness
    ? buildQuoteReviewReply(evidence.sourcingSummary.rfx_id, quoteReview)
    : buildDeterministicCopilotAnswer(message, evidence);
  const detLatencyMs = Math.max(1, Date.now() - tDetStart);

  realTrace.push({
    step: realTrace.length + 1,
    phase: 'Deterministic Procurement Calculation',
    tool: 'deterministic_database_engine',
    input: { reason: 'Gemini synthesis unavailable or did not pass evidence validation' },
    output: { engine: 'SQLite Local Reasoning Node', grounded: true },
    latencyMs: detLatencyMs,
    status: 'completed' as const,
  });

  return res.json({ 
    reply: deterministicReply,
    model: 'sqlite-deterministic-engine',
    route,
    liveLLM: false,
    deterministicAnswer: true,
    executionTrace: realTrace,
    dataQuery,
    isConsolidatedDemand: dataQuery?.isConsolidation || false,
  });
});

// -------------------------------------------------------------
// Read APIs (Database is the Single Source of Truth for the UI)
// -------------------------------------------------------------

app.get('/api/chat/mention-options', async (req, res) => {
  const type = String(req.query.type || '').toLowerCase();
  const search = String(req.query.q || '').trim().slice(0, 80);
  const pattern = `%${search.toLowerCase().replace(/[\\%_]/g, '\\$&')}%`;
  const sources: Record<string, string> = {
    pr: `SELECT pr.pr_number AS id, pr.pr_number AS label, f.name AS detail
      FROM purchase_requests pr JOIN factories f ON f.factory_id = pr.factory_id
      WHERE LOWER(pr.pr_number || ' ' || f.name) LIKE ? ESCAPE '\\'
      ORDER BY pr.pr_number LIMIT 8`,
    rfq: `SELECT rfx_id AS id, rfx_id AS label, title AS detail
      FROM rfxs WHERE LOWER(rfx_id || ' ' || title) LIKE ? ESCAPE '\\'
      ORDER BY rfx_id LIMIT 8`,
    vendor: `SELECT supplier_id AS id, name AS label, code || ' · ' || status AS detail
      FROM suppliers WHERE LOWER(name || ' ' || code || ' ' || supplier_id) LIKE ? ESCAPE '\\'
      ORDER BY name LIMIT 8`,
    item: `SELECT item_id AS id, sku_code AS label, item_name || ' · ' || category AS detail
      FROM items WHERE active = 1 AND LOWER(sku_code || ' ' || item_name || ' ' || category) LIKE ? ESCAPE '\\'
      ORDER BY sku_code LIMIT 8`,
  };
  if (!sources[type]) return res.status(400).json({ error: 'Unsupported mention type' });
  try {
    res.json({ options: await runQuery(sources[type], [pattern]) });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

// 1. Purchase Requisitions Read API
app.get('/api/purchase-requests', async (req, res) => {
  try {
    const rows = await runQuery(`
      SELECT pr.*, f.name as factory_name, f.city as factory_city, f.address as factory_address,
             COUNT(prl.line_id) as lines_count,
             COALESCE(SUM(prl.quantity), 0) as total_quantity,
             COALESCE(SUM(prl.estimated_spend), pr.estimated_budget) as calculated_budget
      FROM purchase_requests pr
      LEFT JOIN factories f ON pr.factory_id = f.factory_id
      LEFT JOIN purchase_request_lines prl ON pr.pr_id = prl.pr_id
      GROUP BY pr.pr_id
      ORDER BY pr.pr_number ASC;
    `);
    res.json({ purchaseRequests: rows });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// 2. Single PR Lines Read API
app.get('/api/purchase-requests/:prId/lines', async (req, res) => {
  try {
    const rows = await runQuery(
      `SELECT l.line_id, l.pr_id, l.item_id, i.sku_code, i.item_name, i.category,
              i.size_specification, i.weight_or_gsm, l.quantity, i.uom,
              l.baseline_rate, l.estimated_spend
       FROM purchase_request_lines l JOIN items i ON i.item_id = l.item_id
       WHERE l.pr_id = ? ORDER BY i.sku_code ASC;`,
      [req.params.prId]
    );
    res.json({ lines: rows });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// 3. Consolidated RFx Lines Read API (30 Lines)
app.get('/api/rfx/lines', async (req, res) => {
  try {
    const rows = await runQuery(`
      SELECT l.rfx_line_id, l.rfx_id, l.item_id, i.sku_code, i.item_name, i.category,
             i.size_specification, i.weight_or_gsm, l.quantity_blr, l.quantity_chn,
             l.total_quantity, i.uom, l.baseline_rate, l.estimated_spend
      FROM rfx_lines l JOIN items i ON i.item_id = l.item_id
      ORDER BY i.category ASC, i.sku_code ASC;
    `);
    res.json({ lines: rows });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Canonical item master shared by requisition, RFx, and quote lines.
app.get('/api/items', async (req, res) => {
  try {
    const rows = await runQuery('SELECT * FROM items ORDER BY category, sku_code;');
    res.json({ items: rows, totalCount: rows.length });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get('/api/items/:itemId/suppliers', async (req, res) => {
  try {
    const rows = await runQuery(`
      SELECT DISTINCT s.supplier_id, s.name, s.code, p.product_family,
             p.qualification_status, p.monthly_capacity_units, p.lead_time_days
      FROM items i
      JOIN supplier_products p ON p.category = i.category AND i.sku_code LIKE p.sku_pattern
      JOIN suppliers s ON s.supplier_id = p.supplier_id
      WHERE i.item_id = ? AND i.active = 1 AND p.active = 1
        AND p.qualification_status = 'approved' AND s.status = 'active'
      ORDER BY s.name;
    `, [req.params.itemId]);
    res.json({ itemId: req.params.itemId, suppliers: rows, totalCount: rows.length });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// 4. Approved Suppliers & Receiving Performance Read API
app.get('/api/suppliers', async (req, res) => {
  try {
    const rows = await runQuery(`
      SELECT s.*, 
             COALESCE(sp.received_deliveries, 0) as received_deliveries,
             COALESCE(sp.on_time_deliveries, 0) as on_time_deliveries,
             COALESCE(sp.otif_pct, 0.0) as otif_pct,
             COALESCE(sp.rejection_rate_pct, 0.0) as rejection_rate_pct,
             COALESCE(sp.notes, '') as performance_notes
      FROM suppliers s
      LEFT JOIN supplier_performance sp ON s.supplier_id = sp.supplier_id
      ORDER BY s.supplier_id ASC;
    `);
    res.json({ suppliers: rows });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// 4b. RFQ Matching Suppliers & Commodity Filtering API
app.get('/api/rfx/matching-suppliers', async (req, res) => {
  try {
    const rfxId = (req.query.rfxId as string) || 'RFQ-2026-041';
    
    // 1. Get required categories in RFQ from rfx_lines
    const rfxCats = await runQuery('SELECT DISTINCT i.category FROM rfx_lines l JOIN items i ON i.item_id = l.item_id WHERE l.rfx_id = ?;', [rfxId]);
    const requiredCategories = rfxCats.map((c: any) => c.category);

    // 2. Total suppliers in enterprise database
    const totalCount = (await runQuery('SELECT count(*) as count FROM suppliers;'))[0]?.count || 0;

    // 3. Matched suppliers joining supplier_categories
    const matched = await runQuery(`
      SELECT 
        s.supplier_id, 
        s.name, 
        s.code, 
        s.supplier_type,
        s.status,
        GROUP_CONCAT(DISTINCT sc.category) as matched_categories_str,
        COUNT(DISTINCT sc.category) as matched_categories_count,
        COALESCE(sp.received_deliveries, 0) as received_deliveries,
        COALESCE(sp.on_time_deliveries, 0) as on_time_deliveries,
        COALESCE(sp.otif_pct, 0.0) as otif_pct,
        COALESCE(sp.rejection_rate_pct, 0.0) as rejection_rate_pct,
        COALESCE(sp.notes, '') as performance_notes
      FROM suppliers s
      JOIN supplier_categories sc ON s.supplier_id = sc.supplier_id
      LEFT JOIN supplier_performance sp ON s.supplier_id = sp.supplier_id
      WHERE sc.category IN (SELECT DISTINCT i.category FROM rfx_lines l JOIN items i ON i.item_id = l.item_id WHERE l.rfx_id = ?)
        AND sc.qualification_status = 'approved'
        AND s.status = 'active'
      GROUP BY s.supplier_id
      ORDER BY sp.otif_pct DESC;
    `, [rfxId]);

    const matchedSuppliers = matched.map((m: any) => {
      const cats = m.matched_categories_str ? m.matched_categories_str.split(',') : [];
      const isMultiProduct = cats.length > 1;
      return {
        supplierId: m.supplier_id,
        name: m.name,
        code: m.code,
        supplierType: m.supplier_type,
        status: m.status,
        matchedCategories: cats,
        isMultiProduct,
        coverageType: isMultiProduct ? `Multi-Product (${cats.length}/${requiredCategories.length} Categories)` : `Single-Category (${cats[0]})`,
        otifPct: m.otif_pct,
        receivedDeliveries: m.received_deliveries,
        onTimeDeliveries: m.on_time_deliveries,
        missedDeliveries: m.received_deliveries - m.on_time_deliveries,
        rejectionRatePct: m.rejection_rate_pct,
        performanceNotes: m.performance_notes,
      };
    });

    // 4. Excluded suppliers supplying other product commodities in the DB
    const excluded = await runQuery(`
      SELECT 
        s.supplier_id, 
        s.name, 
        s.code, 
        s.supplier_type,
        s.status,
        GROUP_CONCAT(DISTINCT sc.category) as categories_str,
        COALESCE(sp.otif_pct, 0.0) as otif_pct
      FROM suppliers s
      LEFT JOIN supplier_categories sc ON s.supplier_id = sc.supplier_id
      LEFT JOIN supplier_performance sp ON s.supplier_id = sp.supplier_id
      WHERE s.supplier_id NOT IN (
        SELECT DISTINCT s2.supplier_id
        FROM suppliers s2
        JOIN supplier_categories sc2 ON s2.supplier_id = sc2.supplier_id
        WHERE sc2.category IN (SELECT DISTINCT i.category FROM rfx_lines l JOIN items i ON i.item_id = l.item_id WHERE l.rfx_id = ?)
          AND sc2.qualification_status = 'approved'
          AND s2.status = 'active'
      )
      GROUP BY s.supplier_id
      ORDER BY sp.otif_pct DESC;
    `, [rfxId]);

    const excludedSuppliers = excluded.map((e: any) => ({
      supplierId: e.supplier_id,
      name: e.name,
      code: e.code,
      supplierType: e.supplier_type,
      status: e.status,
      suppliedCategories: e.categories_str ? e.categories_str.split(',') : [],
      reason: e.status !== 'active' ? `Status: ${e.status}` : `Commodity Mismatch (Supplies ${e.categories_str || 'Other'}, not demanded in RFQ)`,
      otifPct: e.otif_pct,
    }));

    res.json({
      rfxId,
      requiredCategories,
      totalSuppliersInDb: totalCount,
      matchedCount: matchedSuppliers.length,
      excludedCount: excludedSuppliers.length,
      matchedSuppliers,
      excludedSuppliers,
      highPerformanceMatchedCount: matchedSuppliers.filter((s: any) => s.otifPct >= 95.0).length,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// 5. Sourcing Scenarios Read API
app.get('/api/scenarios', async (req, res) => {
  try {
    const rows = await runQuery('SELECT * FROM sourcing_scenarios ORDER BY is_recommended DESC, scenario_id ASC;');
    const formatted = rows.map((r: any) => ({
      ...r,
      notes: r.notes_json ? JSON.parse(r.notes_json) : [],
      isRecommended: Boolean(r.is_recommended),
    }));
    res.json({ scenarios: formatted });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// -------------------------------------------------------------
// Atomic Quote Ingestion Endpoint
// -------------------------------------------------------------
app.post('/api/ingest-document', async (req, res) => {
  const { filename, content, fileBase64, supplierId, documentType, rfxId } = req.body;

  if (!filename || (!fileBase64 && !content)) {
    return res.status(400).json({ error: 'Filename and file data are required' });
  }

  let preparedFile: ReturnType<typeof prepareQuoteFile>;
  try {
    preparedFile = prepareQuoteFile(filename, fileBase64 || Buffer.from(content, 'utf8').toString('base64'));
  } catch (error) {
    return res.status(415).json({ error: (error as Error).message });
  }

  // 1. Structured Parsing via Gemini
  const parsingPrompt = buildDocumentParsingPrompt({
    content: preparedFile.content,
    filename,
    supplierId,
    documentType,
  });

  let extractedData: any = null;

  if (ai) {
    const candidateModels = ['gemini-3.1-flash-lite', 'gemini-flash-latest'];
    for (const m of candidateModels) {
      try {
        const response = await ai.models.generateContent({
          model: m,
          contents: preparedFile.multimodal
            ? [{ text: parsingPrompt }, { inlineData: { mimeType: preparedFile.mimeType, data: fileBase64 } }]
            : parsingPrompt,
        });

        const rawText = response.text?.trim() || '';
        const cleanedJson = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
        extractedData = JSON.parse(cleanedJson);
        break;
      } catch (e) {
        console.warn(`Extraction failed on model ${m}:`, (e as Error)?.message);
      }
    }
  }

  // If extraction failed or returned no lines, DO NOT inject fake supplier sample quotes!
  if (!extractedData || !Array.isArray(extractedData.lines) || extractedData.lines.length === 0) {
    return res.status(422).json({
      error: 'Document parsing failed',
      details: 'Unable to extract structured quote lines from the provided document. Please verify document formatting or provide a clear quotation document.',
    });
  }

  // 2. Normalization with strict null and zero preservation
  const normalizedData = processAndNormalizeQuote(extractedData);
  const [targetRfx] = await runQuery('SELECT rfx_id FROM rfxs WHERE rfx_id = ?;', [rfxId]);
  if (!targetRfx) return res.status(400).json({ error: 'Select a valid RFQ before uploading the quote.' });
  const rfqLines = await runQuery('SELECT rfx_line_id, sku_code, total_quantity, baseline_rate FROM rfx_lines WHERE rfx_id = ?;', [rfxId]);
  normalizedData.lines = normalizedData.lines.map((line) => {
    const matched = rfqLines.find((rfqLine) =>
      [rfqLine.rfx_line_id, rfqLine.sku_code].some((id) => id.toLowerCase() === line.rfx_line_id.toLowerCase()));
    return { ...line, rfx_line_id: matched?.rfx_line_id || line.rfx_line_id };
  });

  const commercialReview = assessRfqCommercialValue(rfqLines, normalizedData.lines);
  if (commercialReview && commercialReview.variancePercent > RFQ_COMMERCIAL_REVIEW_THRESHOLD_PERCENT) {
    normalizedData.field_assessments.push({
      field_name: 'Commercial Value Review',
      raw_value: `Supplier price for full RFQ demand: INR ${commercialReview.quotedValue.toFixed(2)}`,
      normalized_value: `RFQ line-rate baseline: INR ${commercialReview.baselineValue.toFixed(2)} (${commercialReview.variancePercent.toFixed(2)}% variance)`,
      status: 'needs_confirmation',
      reason: 'The full-RFQ quoted value differs by more than 20% from the RFQ line-rate baseline. Ask the supplier to confirm the quoted item prices and total.',
      evidence_snippet: `Compared all ${commercialReview.requiredLines} RFQ lines at their required quantities and recorded baseline rates.`,
    });
  }

  // 3. Atomic Database Transaction Ingestion
  try {
    const result = await runTransaction(async (db) => {
      const timestamp = new Date().toISOString();
      const attachmentId = `ATT-${Date.now()}`;
      const quoteId = `QTE-${Date.now()}`;

      // Resolve or create supplier
      let finalSupplierId = supplierId?.trim();
      const detectedName = normalizedData.supplier_name || 'Detected Supplier';

      let existingSupplier: any = null;
      if (finalSupplierId && finalSupplierId !== 'UNKNOWN_SUPPLIER' && finalSupplierId !== 'SUP-AUTO') {
        const byId = await runQuery('SELECT * FROM suppliers WHERE supplier_id = ?', [finalSupplierId]);
        if (byId && byId.length > 0) existingSupplier = byId[0];
      }

      if (!existingSupplier && detectedName) {
        const byName = await runQuery('SELECT * FROM suppliers WHERE LOWER(name) = ?', [detectedName.toLowerCase()]);
        if (byName && byName.length > 0) existingSupplier = byName[0];
      }

      if (existingSupplier) {
        finalSupplierId = existingSupplier.supplier_id;
      } else {
        finalSupplierId = finalSupplierId && finalSupplierId !== 'UNKNOWN_SUPPLIER' && finalSupplierId !== 'SUP-AUTO'
          ? finalSupplierId
          : `SUP-${Date.now().toString().slice(-4)}`;

        const code = (detectedName.split(' ')[0] || 'VEND').toUpperCase().slice(0, 8);
        const supplierType = 'Packaging & Containers Supplier';

        db.run(
          `INSERT INTO suppliers (supplier_id, name, code, supplier_type, status, default_currency)
           VALUES (?, ?, ?, ?, 'pending_review', ?)`,
          [finalSupplierId, detectedName, code, supplierType, normalizedData.currency || 'INR']
        );

      }

      // 1. Insert Attachment Record
      db.run(
        `INSERT INTO attachments (attachment_id, filename, mime_type, document_type, processed_at, file_size_bytes, file_content)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [attachmentId, filename, preparedFile.mimeType, documentType || 'quote', timestamp,
          preparedFile.buffer.length,
          preparedFile.mimeType.startsWith('text/') || preparedFile.mimeType === 'message/rfc822'
            ? preparedFile.content : `base64:${fileBase64 || preparedFile.buffer.toString('base64')}`]
      );

      // 2. Insert Quote Record (Preserving null and zero distinctly)
      db.run(
        `INSERT INTO quotes (quote_id, rfx_id, supplier_id, message_id, quote_number, quote_date, currency, stated_total_amount, calculated_total_amount, amount_variance, valid_until, payment_terms_days, freight_treatment, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          quoteId,
          rfxId,
          finalSupplierId,
          attachmentId,
          normalizedData.quote_number,
          normalizedData.quote_date,
          normalizedData.currency,
          normalizedData.stated_total_amount,
          normalizedData.calculated_total_amount,
          normalizedData.amount_variance,
          normalizedData.valid_until,
          normalizedData.payment_terms_days,
          normalizedData.freight_treatment,
          'extracted'
        ]
      );

      // 3. Insert Delivery Costs
      if (normalizedData.freight_blr || normalizedData.freight_treatment === 'included') {
        db.run(
          `INSERT INTO quote_delivery_costs (delivery_cost_id, quote_id, factory_id, treatment, amount, currency)
           VALUES (?, ?, 'BLR', ?, ?, 'INR')`,
          [`FRT-BLR-${Date.now()}`, quoteId, normalizedData.freight_treatment, normalizedData.freight_blr]
        );
      }
      if (normalizedData.freight_chn || normalizedData.freight_treatment === 'included') {
        db.run(
          `INSERT INTO quote_delivery_costs (delivery_cost_id, quote_id, factory_id, treatment, amount, currency)
           VALUES (?, ?, 'CHN', ?, ?, 'INR')`,
          [`FRT-CHN-${Date.now()}`, quoteId, normalizedData.freight_treatment, normalizedData.freight_chn]
        );
      }

      // 4. Insert Quote Lines
      normalizedData.lines.forEach((line: any, idx: number) => {
        db.run(
          `INSERT INTO quote_lines (quote_line_id, quote_id, rfx_line_id, item_id, item_name, raw_item_description, quoted_quantity, quoted_uom, unit_price, price_uom, normalized_unit_price, normalized_uom, line_total_amount, moq_quantity, lead_time_days, delivery_date, specification_status)
           VALUES (?, ?, ?, (SELECT item_id FROM rfx_lines WHERE rfx_line_id = ?), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            `QL-${quoteId}-${idx + 1}`,
            quoteId,
            line.rfx_line_id,
            line.rfx_line_id,
            line.item_name,
            line.raw_item_description,
            line.quoted_quantity,
            line.quoted_uom,
            line.unit_price ?? 0,
            line.price_uom || 'not_stated',
            line.normalized_unit_price ?? 0,
            line.normalized_uom,
            line.line_total_amount,
            line.moq_quantity,
            line.lead_time_days,
            line.delivery_date,
            line.specification_status
          ]
        );
      });

      // 5. Insert Field Assessments
      normalizedData.field_assessments.forEach((fa: any, idx: number) => {
        db.run(
          `INSERT INTO field_assessments (assessment_id, quote_id, field_name, raw_value, normalized_value, status, reason, evidence_snippet, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            `ASSESS-${quoteId}-${idx + 1}`,
            quoteId,
            fa.field_name,
            fa.raw_value || '',
            fa.normalized_value || '',
            fa.status,
            fa.reason || '',
            fa.evidence_snippet || '',
            timestamp
          ]
        );
      });

      return { quoteId, attachmentId, supplierId: finalSupplierId };
    });

    res.json({
      success: true,
      quoteId: result.quoteId,
      attachmentId: result.attachmentId,
      extractedData: normalizedData,
      databaseMessage: `Atomically committed quote, ${normalizedData.lines.length} lines, and ${normalizedData.field_assessments.length} actionable assessments in SQLite.`,
    });
  } catch (err: unknown) {
    console.error('Atomic quote ingestion failed:', err);
    res.status(500).json({ error: 'Atomic ingestion failed and was rolled back', details: String(err) });
  }
});

// -------------------------------------------------------------
// Database Editor & Browser Routes (Secured with Allowlist & Parameterization)
// -------------------------------------------------------------

// Database Overview & Stats
app.get('/api/db/overview', async (req, res) => {
  try {
    const stats = {
      factories: (await runQuery('SELECT COUNT(*) as count FROM factories'))[0]?.count || 0,
      suppliers: (await runQuery('SELECT COUNT(*) as count FROM suppliers'))[0]?.count || 0,
      items: (await runQuery('SELECT COUNT(*) as count FROM items'))[0]?.count || 0,
      supplier_categories: (await runQuery('SELECT COUNT(*) as count FROM supplier_categories'))[0]?.count || 0,
      supplier_products: (await runQuery('SELECT COUNT(*) as count FROM supplier_products'))[0]?.count || 0,
      purchase_requests: (await runQuery('SELECT COUNT(*) as count FROM purchase_requests'))[0]?.count || 0,
      rfx_lines: (await runQuery('SELECT COUNT(*) as count FROM rfx_lines'))[0]?.count || 0,
      quotes: (await runQuery('SELECT COUNT(*) as count FROM quotes'))[0]?.count || 0,
      quote_lines: (await runQuery('SELECT COUNT(*) as count FROM quote_lines'))[0]?.count || 0,
      field_assessments: (await runQuery('SELECT COUNT(*) as count FROM field_assessments'))[0]?.count || 0,
      attachments: (await runQuery('SELECT COUNT(*) as count FROM attachments'))[0]?.count || 0,
    };
    res.json({ stats });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Approved Supplier Product Mappings API (1-to-many catalog mapping)
app.get('/api/supplier-products', async (req, res) => {
  try {
    const rows = await runQuery(`
      SELECT 
        sprod.*,
        s.name as supplier_name,
        s.code as supplier_code,
        s.status as supplier_status,
        s.supplier_type
      FROM supplier_products sprod
      JOIN suppliers s ON sprod.supplier_id = s.supplier_id
      ORDER BY sprod.supplier_id ASC, sprod.is_primary DESC;
    `);
    res.json({ mappings: rows, totalCount: rows.length });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Database Table Browser (Get all rows and columns for an allowed table)
app.get('/api/db/table/:tableName', async (req, res) => {
  const { tableName } = req.params;
  if (!ALLOWED_TABLES.includes(tableName)) {
    return res.status(400).json({ error: `Table '${tableName}' is not in the schema allowlist` });
  }

  try {
    const rows = await runQuery(`SELECT * FROM ${tableName} LIMIT 250;`);
    const columns = SCHEMA_ALLOWLIST[tableName].columns;
    res.json({ columns, rows, totalCount: rows.length });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Inline Update Row Endpoint (Strictly Validated Against Column Allowlist)
app.put('/api/db/row', async (req, res) => {
  const { table, primaryKey, primaryKeyValue, updates } = req.body;

  if (!table || !ALLOWED_TABLES.includes(table)) {
    return res.status(400).json({ error: `Invalid or unauthorized table '${table}'` });
  }

  const schema = SCHEMA_ALLOWLIST[table];
  if (primaryKey !== schema.primaryKey) {
    return res.status(400).json({ error: `Invalid primary key '${primaryKey}' for table '${table}'` });
  }

  if (primaryKeyValue === undefined || primaryKeyValue === null) {
    return res.status(400).json({ error: 'Primary key value is required' });
  }

  if (!updates || typeof updates !== 'object') {
    return res.status(400).json({ error: 'Updates object is required' });
  }

  const updateKeys = Object.keys(updates);
  if (updateKeys.length === 0) {
    return res.json({ success: true, message: 'No fields to update' });
  }

  // Validate every update column against schema allowlist
  for (const col of updateKeys) {
    if (!schema.columns.includes(col)) {
      return res.status(400).json({ error: `Unauthorized or non-existent column '${col}' for table '${table}'` });
    }
  }

  try {
    const setClauses = updateKeys.map((k) => `${k} = ?`).join(', ');
    const params = [...Object.values(updates), primaryKeyValue];

    const sql = `UPDATE ${table} SET ${setClauses} WHERE ${primaryKey} = ?;`;
    await runExecute(sql, params);

    res.json({ success: true, message: `Updated row in ${table}`, primaryKeyValue });
  } catch (err) {
    console.error('Update error:', err);
    res.status(500).json({ error: String(err) });
  }
});

// Inline Delete Row Endpoint (Strictly Validated Against Schema Allowlist)
app.delete('/api/db/row', async (req, res) => {
  const { table, primaryKey, primaryKeyValue } = req.body;

  if (!table || !ALLOWED_TABLES.includes(table)) {
    return res.status(400).json({ error: `Invalid or unauthorized table '${table}'` });
  }

  const schema = SCHEMA_ALLOWLIST[table];
  if (primaryKey !== schema.primaryKey) {
    return res.status(400).json({ error: `Invalid primary key '${primaryKey}' for table '${table}'` });
  }

  if (primaryKeyValue === undefined || primaryKeyValue === null) {
    return res.status(400).json({ error: 'Primary key value is required' });
  }

  try {
    const sql = `DELETE FROM ${table} WHERE ${primaryKey} = ?;`;
    await runExecute(sql, [primaryKeyValue]);

    res.json({ success: true, message: `Deleted row from ${table}`, primaryKeyValue });
  } catch (err) {
    console.error('Delete error:', err);
    res.status(500).json({ error: String(err) });
  }
});

// -------------------------------------------------------------
// Supplier Inbox & Quote Details Read Routes (All Parameterized)
// -------------------------------------------------------------

app.get('/api/inbox/rfq-messages', async (req, res) => {
  try {
    const params = typeof req.query.rfxId === 'string' && req.query.rfxId ? [req.query.rfxId] : [];
    const messages = await runQuery(`
      SELECT m.*, s.name AS supplier_name
      FROM rfq_messages m JOIN suppliers s ON s.supplier_id = m.supplier_id
      WHERE m.delivery_status = 'sent' ${params.length ? 'AND m.rfx_id = ?' : ''}
      ORDER BY m.created_at DESC, s.name;
    `, params);
    res.json({ messages });
  } catch (err) {
    console.error('RFQ message list error:', err);
    res.status(500).json({ error: 'Could not load RFQ messages.' });
  }
});

async function getQuoteLineCoverage(quoteId: string, supplierId: string, rfxId: string) {
  const [scope] = await runQuery('SELECT COUNT(*) AS required_lines FROM rfx_lines WHERE rfx_id = ?;', [rfxId]);
  const [quoted] = await runQuery(`
    SELECT COUNT(DISTINCT ql.rfx_line_id) AS quoted_lines,
           COUNT(DISTINCT CASE WHEN NOT EXISTS (
             SELECT 1 FROM supplier_categories sc
             WHERE sc.supplier_id = ? AND sc.category = i.category
               AND sc.active = 1 AND sc.qualification_status = 'approved'
           ) THEN ql.rfx_line_id END) AS out_of_scope_lines
    FROM quote_lines ql
    LEFT JOIN rfx_lines rl ON rl.rfx_line_id = ql.rfx_line_id
    LEFT JOIN items i ON i.item_id = rl.item_id
    WHERE ql.quote_id = ?;
  `, [supplierId, quoteId]);
  return {
    quotedLines: Number(quoted?.quoted_lines || 0),
    requiredLines: Number(scope?.required_lines || 0),
    outOfScopeLines: Number(quoted?.out_of_scope_lines || 0),
  };
}

async function getQuoteRequiredFieldGaps(quote: any): Promise<string[]> {
  const gaps: string[] = [];
  if (quote.stated_total_amount == null || quote.calculated_total_amount == null || Math.abs(Number(quote.amount_variance || 0)) > 0.01) gaps.push('quote total');
  if (!quote.valid_until) gaps.push('quote validity');
  if (!Number.isFinite(Number(quote.payment_terms_days)) || Number(quote.payment_terms_days) <= 0) gaps.push('payment terms');
  if (!quote.freight_treatment || quote.freight_treatment === 'not_stated') gaps.push('freight terms');
  const [lineChecks] = await runQuery(`
    SELECT COUNT(*) AS line_count,
           SUM(CASE WHEN ql.quoted_quantity IS NULL OR ql.quoted_quantity < rl.total_quantity
             OR ql.unit_price IS NULL OR ql.unit_price <= 0 OR ql.normalized_unit_price IS NULL OR ql.normalized_unit_price <= 0
             OR ql.moq_quantity IS NULL OR ql.lead_time_days IS NULL
             OR ql.delivery_date IS NULL OR ql.specification_status <> 'confirmed'
             OR ql.line_total_amount IS NULL
             OR ABS(ql.line_total_amount - ql.quoted_quantity * ql.normalized_unit_price) > 0.01
             THEN 1 ELSE 0 END) AS incomplete_lines,
           SUM(ql.line_total_amount) AS line_total
    FROM quote_lines ql LEFT JOIN rfx_lines rl ON rl.rfx_line_id = ql.rfx_line_id
    WHERE ql.quote_id = ?;
  `, [quote.quote_id]);
  if (Number(lineChecks?.incomplete_lines || 0) > 0 || Number(lineChecks?.line_count || 0) === 0) gaps.push('item prices, quantities, or delivery details');
  if (quote.freight_treatment === 'included' && quote.stated_total_amount != null && Math.abs(Number(lineChecks?.line_total || 0) - Number(quote.stated_total_amount)) > 0.01) gaps.push('item total versus quote total');
  const [delivery] = await runQuery('SELECT COUNT(DISTINCT factory_id) AS plant_count FROM quote_delivery_costs WHERE quote_id = ?;', [quote.quote_id]);
  if (Number(delivery?.plant_count || 0) < 2) gaps.push('delivery cost treatment for both plants');
  return gaps;
}

async function reviewQuoteCompleteness(quote: any) {
  const assessments = await runQuery('SELECT * FROM field_assessments WHERE quote_id = ?;', [quote.quote_id]);
  const missingAssessments = assessments.filter((a) => a.status === 'missing_needs_follow_up');
  const confirmationAssessments = assessments.filter((a) => a.status === 'needs_confirmation');
  const coverage = await getQuoteLineCoverage(quote.quote_id, quote.supplier_id, quote.rfx_id);
  const requiredFieldsMissing = await getQuoteRequiredFieldGaps(quote);
  const evaluation = evaluateQuoteCompleteness({
    ...coverage,
    missingFields: missingAssessments.map((a) => a.field_name),
    confirmationFields: confirmationAssessments.map((a) => a.field_name),
    supplierStatus: quote.supplier_status,
    requiredFieldsMissing,
  });
  return {
    quote_id: quote.quote_id,
    quote_number: quote.quote_number,
    supplier_id: quote.supplier_id,
    supplier_name: quote.supplier_name,
    supplier_status: quote.supplier_status,
    rfx_id: quote.rfx_id,
    status: quote.status,
    stated_total_amount: quote.stated_total_amount,
    valid_until: quote.valid_until,
    payment_terms_days: quote.payment_terms_days,
    freight_treatment: quote.freight_treatment,
    completeness_status: evaluation.status,
    quoted_lines_count: coverage.quotedLines,
    rfx_lines_count: coverage.requiredLines,
    out_of_scope_lines_count: coverage.outOfScopeLines,
    required_fields_missing: requiredFieldsMissing,
    missing_fields: missingAssessments.map((a) => a.field_name),
    confirmation_fields: confirmationAssessments.map((a) => a.field_name),
    action_needed: evaluation.issues.join('; ') || 'Ready for award review',
    assessments_count: assessments.length,
    missing_count: missingAssessments.length,
    confirmation_count: confirmationAssessments.length,
  };
}

function buildQuoteReviewReply(rfxId: string, reviews: Awaited<ReturnType<typeof reviewQuoteCompleteness>>[]): string {
  const scoped = reviews.filter((quote) => quote.rfx_id === rfxId);
  const complete = scoped.filter((quote) => quote.completeness_status === 'complete');
  const others = scoped.filter((quote) => quote.completeness_status !== 'complete');
  const completeRows = complete.map((quote) =>
    `| ${quote.supplier_name} (${quote.supplier_id}) | [${quote.quote_number}](#quote=${encodeURIComponent(quote.quote_id)}) | ${formatInr(quote.stated_total_amount)} | Net ${quote.payment_terms_days} days; freight ${quote.freight_treatment}; valid to ${quote.valid_until} |`
  ).join('\n');
  const sampleNames = complete.filter((quote) => quote.status === 'sample_ready_for_review').map((quote) => quote.supplier_name);
  const otherRows = others.map((quote) =>
    `| ${quote.supplier_name} (${quote.supplier_id}) | ${quote.quoted_lines_count}/${quote.rfx_lines_count} | [Review ${quote.quote_id}](#quote=${encodeURIComponent(quote.quote_id)}): ${quote.action_needed.replace(/\|/g, '/')} |`
  ).join('\n');
  return `### Quote completeness for ${rfxId}

${complete.length ? `**${complete.length} supplier${complete.length === 1 ? '' : 's'} have complete quotes covering all ${complete[0].rfx_lines_count} RFQ items:**\n\n| Supplier | Complete quote | Quoted total | Commercial terms |\n| --- | --- | ---: | --- |\n${completeRows}${sampleNames.length ? `\n\n${sampleNames.join(', ')} ${sampleNames.length === 1 ? 'has a sample quote' : 'have sample quotes'}; confirm the original supplier submission before award.` : ''}` : 'No quote currently passes the recorded completeness checks.'}

${others.length ? `**Other recorded quotes needing attention:**\n\n| Supplier | RFQ items | Missing terms or qualification issues |\n|---|---:|---|\n${otherRows}\n\n` : ''}The completeness check covers RFQ line coverage, required quote fields, plant freight treatment, recorded assessments, supplier status, and approved categories. Open a quote link to inspect its original message and line details. These sample quotes are for review; the database does not independently verify external certification documents.`;
}

// Quotes List Endpoint with Completeness
app.get('/api/inbox/quotes', async (req, res) => {
  try {
    const rfxId = typeof req.query.rfxId === 'string' && req.query.rfxId.trim() ? req.query.rfxId.trim() : null;
    const quotes = await runQuery(`
      SELECT 
        q.*, 
        s.name as supplier_name, 
        s.code as supplier_code, 
        s.supplier_type as supplier_capabilities,
        s.status as supplier_status, 
        a.filename as attachment_filename
      FROM quotes q
      LEFT JOIN suppliers s ON q.supplier_id = s.supplier_id
      LEFT JOIN attachments a ON q.message_id = a.attachment_id
      WHERE (? IS NULL OR q.rfx_id = ?)
      ORDER BY q.quote_date DESC;
    `, [rfxId, rfxId]);

    // For each quote, compute completeness and missing fields
    const enriched = await Promise.all(
      quotes.map(async (q) => ({ ...q, ...await reviewQuoteCompleteness(q) }))
    );

    res.json({ quotes: enriched, count: enriched.length, rfxId });
  } catch (err) {
    console.error('Inbox quotes error:', err);
    res.status(500).json({ error: String(err) });
  }
});

// Full Quote Details with Past Conversations (Parameterized)
app.get('/api/inbox/quote/:quoteId', async (req, res) => {
  const { quoteId } = req.params;
  try {
    const quotes = await runQuery(`
      SELECT 
        q.*, 
        s.name as supplier_name, 
        s.code as supplier_code, 
        s.supplier_type as supplier_capabilities,
        s.status as supplier_status, 
        a.filename as attachment_filename,
        a.mime_type as attachment_mime_type,
        a.processed_at as attachment_processed_at,
        a.file_size_bytes as attachment_file_size,
        CASE WHEN SUBSTR(a.file_content, 1, 7) = 'base64:' THEN NULL ELSE a.file_content END as original_document_text
      FROM quotes q
      LEFT JOIN suppliers s ON q.supplier_id = s.supplier_id
      LEFT JOIN attachments a ON q.message_id = a.attachment_id
      WHERE q.quote_id = ?;
    `, [quoteId]);

    if (!quotes || quotes.length === 0) {
      return res.status(404).json({ error: 'Quote not found' });
    }

    const quote = quotes[0];
    const lines = await runQuery(`
      SELECT ql.*, COALESCE(i.item_name, rl.item_name, ql.item_name) AS item_name
      FROM quote_lines ql
      LEFT JOIN rfx_lines rl ON rl.rfx_line_id = ql.rfx_line_id
      LEFT JOIN items i ON i.item_id = rl.item_id
      WHERE ql.quote_id = ? ORDER BY ql.rfx_line_id ASC;
    `, [quoteId]);
    const assessments = await runQuery('SELECT * FROM field_assessments WHERE quote_id = ? ORDER BY assessment_id ASC;', [quoteId]);
    const deliveryCosts = await runQuery('SELECT * FROM quote_delivery_costs WHERE quote_id = ?;', [quoteId]);
    const capabilities = await runQuery(`SELECT sc.category, sc.monthly_capacity_units AS category_capacity,
      sc.lead_time_days, sc.qualification_status, sc.certified_standards,
      MIN(CASE WHEN p.active = 1 AND p.qualification_status = 'approved' THEN p.monthly_capacity_units END) AS product_capacity,
      sp.otif_pct
      FROM supplier_categories sc
      LEFT JOIN supplier_products p ON p.supplier_id = sc.supplier_id AND p.category = sc.category
      LEFT JOIN supplier_performance sp ON sp.supplier_id = sc.supplier_id
      WHERE sc.supplier_id = ? AND sc.active = 1
      GROUP BY sc.category;`, [quote.supplier_id]);
    const conversations = await runQuery("SELECT * FROM quote_conversations WHERE quote_id = ? AND delivery_status <> 'draft' ORDER BY timestamp ASC;", [quoteId]);
    const drafts = await runQuery("SELECT * FROM quote_conversations WHERE quote_id = ? AND delivery_status = 'draft' ORDER BY timestamp DESC LIMIT 1;", [quoteId]);
    const rfqMessages = await runQuery(`SELECT * FROM rfq_messages
      WHERE rfx_id = ? AND supplier_id = ? AND delivery_status = 'sent'
      ORDER BY created_at ASC;`, [quote.rfx_id, quote.supplier_id]);
    const coverage = await getQuoteLineCoverage(quoteId, quote.supplier_id, quote.rfx_id);
    const submission = conversations.find((message: any) => message.sender === 'supplier' && message.action_type === 'submission');
    const originalMessage = submission || {
      conversation_id: `ORIGINAL-${quoteId}`,
      sender: 'supplier',
      sender_name: quote.supplier_name,
      timestamp: quote.quote_date,
      subject: `Original quotation: ${quote.quote_number}`,
      message_text: quote.original_document_text
        ? quote.attachment_mime_type?.startsWith('text/') || quote.attachment_mime_type === 'message/rfc822'
          ? `Original submitted quotation document (${quote.attachment_filename}):\n\n${String(quote.original_document_text).slice(0, 10000)}`
          : `Original submitted quotation document (${quote.attachment_filename}). Open the attachment to review the original file.`
        : quote.attachment_filename
        ? `The supplier submitted quotation ${quote.quote_number} as ${quote.attachment_filename}. Open the attachment above to review the original document.`
        : `Original email body was not saved. The supplier's quotation ${quote.quote_number} was recorded on ${quote.quote_date}.`,
      delivery_status: 'source_record',
    };

    res.json({
      quote,
      lines,
      assessments,
      deliveryCosts,
      capabilities,
      conversations: submission ? conversations.filter((message: any) => message.conversation_id !== submission.conversation_id) : conversations,
      rfqMessages,
      drafts,
      originalMessage,
      coverage,
    });
  } catch (err) {
    console.error('Quote details error:', err);
    res.status(500).json({ error: String(err) });
  }
});

// Save a follow-up draft in the supplier conversation. No email transport is configured.
app.post('/api/inbox/quote/:quoteId/message', async (req, res) => {
  const { quoteId } = req.params;
  const { subject, messageText, demo } = req.body;

  if (!messageText) {
    return res.status(400).json({ error: 'Message text is required' });
  }

  try {
    const quote = await runQuery('SELECT quote_id FROM quotes WHERE quote_id = ?;', [quoteId]);
    if (!quote.length) return res.status(404).json({ error: 'Quote not found' });
    const convId = `CONV-${Date.now()}`;
    const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);

    await runTransaction((db) => {
      db.run("DELETE FROM quote_conversations WHERE quote_id = ? AND delivery_status = 'draft';", [quoteId]);
      db.run(`INSERT INTO quote_conversations (conversation_id, quote_id, sender, sender_name, timestamp, subject, message_text, action_type, delivery_status)
        VALUES (?, ?, 'agent', 'Sourcing Team', ?, ?, ?, 'inquiry', ?);`,
        [convId, quoteId, timestamp, subject || 'Clarification Follow-Up', messageText, demo ? 'demo' : 'draft']);
    });

    const conversations = await runQuery(
      "SELECT * FROM quote_conversations WHERE quote_id = ? AND delivery_status <> 'draft' ORDER BY timestamp ASC;",
      [quoteId]
    );

    res.json({ success: true, deliveryStatus: demo ? 'demo' : 'draft', conversations });
  } catch (err) {
    console.error('Send message error:', err);
    res.status(500).json({ error: String(err) });
  }
});

// Generate AI Follow-Up Clarification Email using Prompt File: server/prompts/vendorFollowUpEmailPrompt.ts
app.post('/api/quotes/:quoteId/generate-follow-up', async (req, res) => {
  const { quoteId } = req.params;
  const { buyerNotes } = req.body;

  try {
    const quotes = await runQuery(`
      SELECT q.*, s.name as supplier_name, s.code as supplier_code, s.status as supplier_status
      FROM quotes q
      LEFT JOIN suppliers s ON q.supplier_id = s.supplier_id
      WHERE q.quote_id = ?;
    `, [quoteId]);

    if (!quotes || quotes.length === 0) {
      return res.status(404).json({ error: 'Quote not found' });
    }

    const quote = quotes[0];
    const quoteReview = await reviewQuoteCompleteness(quote);
    const assessments = await runQuery(
      'SELECT * FROM field_assessments WHERE quote_id = ? AND status IN (?, ?);',
      [quoteId, 'needs_confirmation', 'missing_needs_follow_up']
    );
    const hasOpenUnitQuestion = assessments.some((item: any) => /UOM|unit weight|price basis/i.test(`${item.field_name} ${item.reason}`));
    const followUpGaps = quoteReview.required_fields_missing.filter((field: string) =>
      !hasOpenUnitQuestion || !['quote total', 'item prices, quantities, or delivery details', 'item total versus quote total'].includes(field));
    const followUpPrompt = buildVendorFollowUpEmailPrompt({
      supplierName: quote.supplier_name,
      supplierCode: quote.supplier_code,
      quoteNumber: quote.quote_number,
      quoteDate: quote.quote_date,
      rfxId: quote.rfx_id,
      missingDetails: [...assessments.map((a: any) => ({
        fieldName: a.field_name,
        rawValue: a.raw_value,
        status: a.status,
        reason: a.reason,
      })), ...followUpGaps.map((field: string) => ({
        fieldName: field, rawValue: 'Not confirmed in quote', status: 'missing_needs_follow_up', reason: 'Needed for award review',
      }))],
      buyerNotes: buyerNotes,
    });

    let draftEmail = '';
    let generationModel: string | null = null;

    if (ai) {
      try {
        for (const model of ['gemini-3.1-flash-lite', 'gemini-flash-latest']) {
          try {
            const response = await ai.models.generateContent({ model, contents: followUpPrompt });
            draftEmail = response.text || '';
            if (draftEmail) { generationModel = model; break; }
          } catch (modelError) {
            console.warn(`Follow-up model ${model} unavailable:`, (modelError as Error)?.message || modelError);
          }
        }
      } catch (err) {
        console.warn('Gemini follow-up generation failed, building deterministic draft:', err);
      }
    }

    if (/\b(parsed|mathematically reconciled|normalized|ingested|LLM|SQLite|database|automated evaluation)\b/i.test(draftEmail)) {
      draftEmail = '';
      generationModel = null;
    }

    if (!draftEmail) {
      const unitQuestions = new Map<string, string>();
      for (const assessment of assessments) {
        const description = `${assessment.field_name} ${assessment.reason}`;
        if (!/UOM|unit weight|price basis|per kg/i.test(description)) continue;
        const sku = assessment.field_name.match(/[A-Z]{2,5}-\d{3,}/)?.[0] || 'the affected item';
        const raw = assessment.raw_value || '';
        unitQuestions.set(sku, `For ${sku}, please confirm the weight of one item in grams and whether ${raw ? `the quoted ${raw}` : 'the quoted rate'} is per kg.`);
      }
      const hasCommercialReview = assessments.some((assessment: any) => /quote total|reconciliation|commercial value/i.test(`${assessment.field_name} ${assessment.reason}`));
      const otherQuestions = assessments.filter((assessment: any) =>
        !/UOM|unit weight|price basis|per kg|quote total|reconciliation|commercial value/i.test(`${assessment.field_name} ${assessment.reason}`))
        .map((assessment: any) => `Please confirm ${assessment.field_name.toLowerCase()}${assessment.raw_value ? ` (the quote states "${assessment.raw_value}")` : ''}.`);
      const questions = [...unitQuestions.values(), ...otherQuestions,
        ...(hasCommercialReview ? ['Please review and confirm the quoted prices, quantities, and stated total in your quotation.'] : []),
        ...followUpGaps.map((field: string) => `Please confirm the ${field}.`)];
      const itemsList = questions.map((question, index) => `${index + 1}. ${question}`).join('\n');

      draftEmail = `Dear ${quote.supplier_name} Commercial Team,

Thank you for your quotation ${quote.quote_number}. Could you please clarify the following points?

${itemsList}

${buyerNotes ? `Note from buyer: ${buyerNotes}\n` : ''}
Please reply with these details so we can complete our review.

Best regards,
Sourcing Team`;
    }

    res.json({
      success: true,
      subject: `Clarification on quotation ${quote.quote_number}`,
      body: draftEmail.replace(/^Subject:[^\n]*\n+/i, '').trim(),
      quoteId,
      supplierName: quote.supplier_name,
      promptFile: 'server/prompts/vendorFollowUpEmailPrompt.ts',
      generationModel: generationModel || 'buyer-friendly-fallback',
    });
  } catch (err) {
    console.error('Follow-up generation error:', err);
    res.status(500).json({ error: String(err) });
  }
});

// A supplier reply in the upload demo is stored as a conversation and applied only where
// the reply supplies explicit values. The buyer's clarification is a demo record, not email.
app.post('/api/inbox/quote/:quoteId/supplier-reply', async (req, res) => {
  const { quoteId } = req.params;
  const messageText = String(req.body?.messageText || '').trim();
  if (!messageText) return res.status(400).json({ error: 'Supplier reply is required.' });
  try {
    const [quote] = await runQuery(`SELECT q.*, s.name AS supplier_name, s.status AS supplier_status
      FROM quotes q JOIN suppliers s ON s.supplier_id = q.supplier_id WHERE q.quote_id = ?;`, [quoteId]);
    if (!quote) return res.status(404).json({ error: 'Quote not found.' });
    const lines = await runQuery(`SELECT ql.*, rl.sku_code FROM quote_lines ql
      LEFT JOIN rfx_lines rl ON rl.rfx_line_id = ql.rfx_line_id WHERE ql.quote_id = ?;`, [quoteId]);
    const rfqReferenceLines = await runQuery(`SELECT rfx_line_id, total_quantity, baseline_rate
      FROM rfx_lines WHERE rfx_id = ?;`, [quote.rfx_id]);
    const assessments = await runQuery(`SELECT * FROM field_assessments WHERE quote_id = ?
      AND status IN ('needs_confirmation', 'missing_needs_follow_up');`, [quoteId]);
    const deliveryCosts = await runQuery('SELECT * FROM quote_delivery_costs WHERE quote_id = ?;', [quoteId]);
    type ReplyLine = { sku_code: string; unit_weight_grams?: number; unit_price?: number; price_uom?: string;
      quoted_quantity?: number; moq_quantity?: number; lead_time_days?: number; delivery_date?: string; specification_status?: string };
    type ReplyFacts = { lines?: ReplyLine[]; valid_until?: string; payment_terms_days?: number;
      freight_treatment?: string; freight_blr?: number; freight_chn?: number; stated_total_amount?: number };
    let facts: ReplyFacts = {};
    if (ai) {
      for (const model of ['gemini-3.1-flash-lite', 'gemini-flash-latest']) {
        try {
          const response = await ai.models.generateContent({
            model,
            contents: `Extract only facts explicitly confirmed in this supplier reply. Do not fill omitted fields. Match SKU codes only from the supplied quote lines. If a quoted price is per kg and the supplier states the weight of one item, return unit_weight_grams; do not calculate the per-item price. Return JSON only with optional keys lines, valid_until (YYYY-MM-DD), payment_terms_days, freight_treatment (included/extra/separate_line), freight_blr and freight_chn (explicit extra freight amount per plant), stated_total_amount. Each lines entry may contain sku_code and only explicitly stated unit_weight_grams, unit_price, price_uom, quoted_quantity, moq_quantity, lead_time_days, delivery_date (YYYY-MM-DD), specification_status (confirmed/exception).\nQuote lines: ${JSON.stringify(lines.map((line) => ({ sku_code: line.sku_code, item_name: line.item_name, unit_price: line.unit_price, price_uom: line.price_uom })))}\nOpen questions: ${JSON.stringify(assessments.map((item) => ({ field_name: item.field_name, reason: item.reason })))}\nSupplier reply: ${JSON.stringify(messageText)}`,
            config: { responseMimeType: 'application/json', temperature: 0 },
          });
          facts = JSON.parse(response.text || '{}');
          break;
        } catch (error) {
          console.warn(`Supplier reply model ${model} unavailable:`, (error as Error)?.message || error);
        }
      }
    }
    // A narrow text fallback keeps the unit-weight demonstration usable during model outages.
    // It only accepts an explicit gram value and an identifiable SKU, or a single open kg line.
    const kgLines = lines.filter((line) => /\bkg\b|kilo/i.test(line.price_uom) && Number(line.normalized_unit_price) <= 0);
    for (const line of kgLines) {
      if (facts.lines?.some((item) => item.sku_code === line.sku_code && item.unit_weight_grams)) continue;
      const at = messageText.toLowerCase().indexOf(String(line.sku_code).toLowerCase());
      const segment = at >= 0 ? messageText.slice(at, at + 160) : kgLines.length === 1 ? messageText : '';
      const nextSku = segment.slice(String(line.sku_code).length).search(/\b[A-Z]{2,5}-\d{3,}\b/i);
      const nearby = nextSku >= 0 ? segment.slice(0, String(line.sku_code).length + nextSku) : segment;
      const gramMatch = nearby.match(/\b(\d+(?:\.\d+)?)\s*(?:g|grams?)\b/i);
      if (gramMatch) facts.lines = [...(facts.lines || []), { sku_code: line.sku_code, unit_weight_grams: Number(gramMatch[1]) }];
    }
    const changed: string[] = [];
    const lineState = lines.map((line) => ({ ...line }));
    const timestamp = new Date().toISOString();
    await runTransaction((db) => {
      db.run(`INSERT INTO quote_conversations (conversation_id, quote_id, sender, sender_name, timestamp, subject, message_text, action_type, delivery_status)
        VALUES (?, ?, 'supplier', ?, ?, 'Clarification response', ?, 'response', 'received_demo');`,
        [`CONV-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, quoteId, quote.supplier_name, timestamp, messageText]);
      for (const update of Array.isArray(facts.lines) ? facts.lines : []) {
        const unresolvedKgLines = lineState.filter((item) => /\bkg\b|kilo/i.test(item.price_uom) && Number(item.normalized_unit_price) <= 0);
        const line = lineState.find((item) => item.sku_code?.toLowerCase() === String(update.sku_code || '').toLowerCase())
          || (update.unit_weight_grams && unresolvedKgLines.length === 1 ? unresolvedKgLines[0] : undefined);
        if (!line) continue;
        const set: string[] = [];
        const values: unknown[] = [];
        const put = (column: string, value: unknown) => { set.push(`${column} = ?`); values.push(value); (line as any)[column] = value; };
        if (Number.isFinite(update.unit_price) && Number(update.unit_price) > 0) put('unit_price', Number(update.unit_price));
        if (update.price_uom) put('price_uom', String(update.price_uom));
        if (Number.isInteger(update.quoted_quantity) && Number(update.quoted_quantity) > 0) put('quoted_quantity', Number(update.quoted_quantity));
        if (Number.isInteger(update.moq_quantity) && Number(update.moq_quantity) > 0) put('moq_quantity', Number(update.moq_quantity));
        if (Number.isInteger(update.lead_time_days) && Number(update.lead_time_days) > 0) put('lead_time_days', Number(update.lead_time_days));
        if (update.delivery_date && /^\d{4}-\d{2}-\d{2}$/.test(update.delivery_date)) put('delivery_date', update.delivery_date);
        if (update.specification_status === 'confirmed' || update.specification_status === 'exception') put('specification_status', update.specification_status);
        let normalized = Number(line.normalized_unit_price);
        if (/\bkg\b|kilo/i.test(line.price_uom)) {
          if (Number.isFinite(update.unit_weight_grams) && Number(update.unit_weight_grams) > 0) {
            normalized = Math.round(Number(line.unit_price) * Number(update.unit_weight_grams) / 1000 * 10000) / 10000;
            put('normalized_unit_price', normalized);
            put('normalized_uom', 'EA');
            for (const assessment of assessments.filter((item) => {
              const description = `${item.field_name} ${item.reason}`;
              return /UOM|unit|kg|weight|price basis/i.test(description)
                && (description.includes(line.sku_code) || unresolvedKgLines.length === 1);
            })) {
              db.run(`UPDATE field_assessments SET status = 'resolved_from_supplier', normalized_value = ?, evidence_snippet = ?, updated_at = ? WHERE assessment_id = ?;`,
                [`${update.unit_weight_grams} g per EA; INR ${normalized.toFixed(4)} per EA`, messageText, timestamp, assessment.assessment_id]);
            }
            changed.push(`${line.sku_code}: ${update.unit_weight_grams} g per EA, INR ${normalized.toFixed(4)} per EA`);
          }
        } else if (update.unit_price || update.price_uom) {
          normalized = normalizePriceAndUom(Number(line.unit_price), line.price_uom).normalizedPrice || 0;
          put('normalized_unit_price', normalized);
          put('normalized_uom', 'EA');
        }
        if (normalized > 0 && Number(line.quoted_quantity) > 0) put('line_total_amount', Math.round(normalized * Number(line.quoted_quantity) * 100) / 100);
        if (set.length) {
          db.run(`UPDATE quote_lines SET ${set.join(', ')} WHERE quote_line_id = ?;`, [...values, line.quote_line_id]);
          if (!changed.some((item) => item.startsWith(`${line.sku_code}:`))) changed.push(`${line.sku_code} updated`);
          for (const assessment of assessments) {
            const field = String(assessment.field_name).toLowerCase();
            const matchesLine = field.includes(String(line.sku_code).toLowerCase()) || field.includes(String(line.item_name).toLowerCase());
            const resolved = (update.unit_price && /price|rate/.test(field)) ||
              (update.quoted_quantity && /quantity/.test(field)) ||
              (update.moq_quantity && /moq/.test(field)) ||
              ((update.lead_time_days || update.delivery_date) && /lead time|delivery/.test(field)) ||
              (update.specification_status === 'confirmed' && /specification/.test(field));
            if (matchesLine && resolved) db.run(`UPDATE field_assessments SET status = 'resolved_from_supplier', evidence_snippet = ?, updated_at = ? WHERE assessment_id = ?;`,
              [messageText, timestamp, assessment.assessment_id]);
          }
        }
      }
      let freightTotal = deliveryCosts.reduce((sum, cost) => sum + Number(cost.amount || 0), 0);
      for (const [factory, statedAmount] of [['BLR', facts.freight_blr], ['CHN', facts.freight_chn]] as const) {
        const amount = facts.freight_treatment === 'included' ? 0 : statedAmount;
        if (!Number.isFinite(amount) || Number(amount) < 0) continue;
        const previous = deliveryCosts.find((cost) => cost.factory_id === factory);
        if (previous) {
          db.run('UPDATE quote_delivery_costs SET amount = ? WHERE delivery_cost_id = ?;', [Number(amount), previous.delivery_cost_id]);
          freightTotal += Number(amount) - Number(previous.amount || 0);
        } else {
          db.run(`INSERT INTO quote_delivery_costs (delivery_cost_id, quote_id, factory_id, treatment, amount, currency)
            VALUES (?, ?, ?, ?, ?, ?);`, [`FRT-${factory}-${Date.now()}`, quoteId, factory, facts.freight_treatment || quote.freight_treatment, Number(amount), quote.currency]);
          freightTotal += Number(amount);
        }
        changed.push(`${factory} freight confirmed`);
      }
      const quoteSet: string[] = [];
      const quoteValues: Array<string | number | null> = [];
      const quotePut = (column: string, value: string | number | null) => { quoteSet.push(`${column} = ?`); quoteValues.push(value); };
      if (facts.valid_until && /^\d{4}-\d{2}-\d{2}$/.test(facts.valid_until)) quotePut('valid_until', facts.valid_until);
      if (Number.isInteger(facts.payment_terms_days) && Number(facts.payment_terms_days) > 0) quotePut('payment_terms_days', Number(facts.payment_terms_days));
      if (['included', 'extra', 'separate_line'].includes(String(facts.freight_treatment))) quotePut('freight_treatment', String(facts.freight_treatment));
      if (Number.isFinite(facts.stated_total_amount) && Number(facts.stated_total_amount) > 0) quotePut('stated_total_amount', Number(facts.stated_total_amount));
      const allLineTotals = lineState.every((line) => Number(line.line_total_amount) > 0);
      if (allLineTotals) {
        const total = Math.round((lineState.reduce((sum, line) => sum + Number(line.line_total_amount), 0) + freightTotal) * 100) / 100;
        quotePut('calculated_total_amount', total);
        const stated = Number(facts.stated_total_amount ?? quote.stated_total_amount);
        quotePut('amount_variance', Number.isFinite(stated) ? Math.round(Math.abs(stated - total) * 100) / 100 : null);
      }
      if (quoteSet.length) db.run(`UPDATE quotes SET ${quoteSet.join(', ')} WHERE quote_id = ?;`, [...quoteValues, quoteId]);
      const commercialReview = assessRfqCommercialValue(rfqReferenceLines, lineState);
      const currentCommercialAssessment = assessments.find((assessment) => assessment.field_name === 'Commercial Value Review');
      if (!commercialReview || commercialReview.variancePercent <= RFQ_COMMERCIAL_REVIEW_THRESHOLD_PERCENT) {
        if (currentCommercialAssessment) {
          db.run(`UPDATE field_assessments SET status = 'resolved_from_supplier',
            normalized_value = ?, evidence_snippet = ?, updated_at = ? WHERE assessment_id = ?;`, [
            commercialReview
              ? `Full RFQ quote INR ${commercialReview.quotedValue.toFixed(2)} versus RFQ baseline INR ${commercialReview.baselineValue.toFixed(2)} (${commercialReview.variancePercent.toFixed(2)}% variance)`
              : 'The full-RFQ price threshold does not apply until all RFQ demand is quoted.',
            messageText, timestamp, currentCommercialAssessment.assessment_id,
          ]);
          changed.push('RFQ commercial value review cleared');
        }
      } else {
        const rawValue = `Supplier price for full RFQ demand: INR ${commercialReview.quotedValue.toFixed(2)}`;
        const normalizedValue = `RFQ line-rate baseline: INR ${commercialReview.baselineValue.toFixed(2)} (${commercialReview.variancePercent.toFixed(2)}% variance)`;
        if (currentCommercialAssessment) {
          db.run(`UPDATE field_assessments SET raw_value = ?, normalized_value = ?, updated_at = ? WHERE assessment_id = ?;`,
            [rawValue, normalizedValue, timestamp, currentCommercialAssessment.assessment_id]);
        } else {
          db.run(`INSERT INTO field_assessments
            (assessment_id, quote_id, field_name, raw_value, normalized_value, status, reason, evidence_snippet, updated_at)
            VALUES (?, ?, 'Commercial Value Review', ?, ?, 'needs_confirmation', ?, ?, ?);`, [
            `ASSESS-${quoteId}-RFQ-VALUE`, quoteId, rawValue, normalizedValue,
            'The full-RFQ quoted value differs by more than 20% from the RFQ line-rate baseline. Ask the supplier to confirm the quoted item prices and total.',
            `Compared all ${commercialReview.requiredLines} RFQ lines at their required quantities and recorded baseline rates.`, timestamp,
          ]);
        }
      }
      for (const assessment of assessments) {
        if ((facts.valid_until && /validity/i.test(assessment.field_name)) ||
            (facts.payment_terms_days && /payment/i.test(assessment.field_name)) ||
            ((facts.freight_treatment || facts.freight_blr != null || facts.freight_chn != null) && /freight/i.test(assessment.field_name))) {
          db.run(`UPDATE field_assessments SET status = 'resolved_from_supplier', evidence_snippet = ?, updated_at = ? WHERE assessment_id = ?;`,
            [messageText, timestamp, assessment.assessment_id]);
          changed.push(`${assessment.field_name} confirmed`);
        }
        if (allLineTotals && /quote total|reconciliation/i.test(assessment.field_name)
          && Number(facts.stated_total_amount ?? quote.stated_total_amount) > 0
          && Math.abs(Number(facts.stated_total_amount ?? quote.stated_total_amount) -
            (lineState.reduce((sum, line) => sum + Number(line.line_total_amount), 0) + freightTotal)) <= 0.01) {
          db.run(`UPDATE field_assessments SET status = 'resolved_from_supplier', evidence_snippet = ?, updated_at = ? WHERE assessment_id = ?;`,
            [messageText, timestamp, assessment.assessment_id]);
        }
      }
    });
    const [updated] = await runQuery(`SELECT q.*, s.name AS supplier_name, s.status AS supplier_status
      FROM quotes q JOIN suppliers s ON s.supplier_id = q.supplier_id WHERE q.quote_id = ?;`, [quoteId]);
    const review = await reviewQuoteCompleteness(updated);
    if (review.completeness_status === 'complete') await runExecute(`UPDATE quotes SET status = 'ready_for_review' WHERE quote_id = ?;`, [quoteId]);
    res.json({ success: true, changed, review, extractionAvailable: Boolean(facts.lines?.length || Object.keys(facts).length),
      message: review.completeness_status === 'complete' ? 'All recorded quote checks pass. This quote is available for award comparison.' : 'Reply saved. Remaining details are shown in the quote review.' });
  } catch (error) {
    console.error('Supplier clarification error:', error);
    res.status(500).json({ error: 'Could not apply the supplier clarification. No quote values were changed.' });
  }
});

// Download an attachment stored in SQLite database (Parameterized)
app.get('/api/attachments/:id/download', async (req, res) => {
  const { id } = req.params;
  try {
    const rows = await runQuery('SELECT * FROM attachments WHERE attachment_id = ?;', [id]);
    if (!rows || rows.length === 0) {
      return res.status(404).json({ error: 'Attachment not found' });
    }
    const att = rows[0];
    const content = att.file_content || `Source file: ${att.filename}\nUploaded: ${att.processed_at}`;

    res.setHeader('Content-Disposition', `attachment; filename="${String(att.filename).replace(/["\r\n]/g, '')}"`);
    res.setHeader('Content-Type', att.mime_type || 'text/plain');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(typeof content === 'string' && content.startsWith('base64:')
      ? Buffer.from(content.slice(7), 'base64') : content);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// RFQ Multi-Sheet Excel Document Download Endpoint
app.get('/api/rfq/excel', async (req, res) => {
  try {
    const buffer = generateRfqWorkbookBuffer(await loadRfqWorkbookLines());
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="A2B_Packaging_RFQ_2026_041.xlsx"');
    res.send(buffer);
  } catch (err) {
    console.error('Failed to generate RFQ Excel file:', err);
    res.status(500).json({ error: String(err) });
  }
});

// Email transport is not configured. Never mark an RFQ dispatched without delivery evidence.
const handleRfqDispatch = (_req: express.Request, res: express.Response) => {
  res.status(501).json({ error: 'RFQ email delivery is not configured. No supplier invitations were sent.' });
};

app.post('/api/rfq/dispatch', handleRfqDispatch);
app.post('/api/rfp/dispatch', handleRfqDispatch);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Procure Sourcing Copilot',
    timestamp: new Date().toISOString(),
    geminiConfigured: !!ai,
  });
});

// Sample Quote Files Data
const SAMPLE_QUOTE_FILES: Record<string, { filename: string; supplier: string; title: string; content: string }> = {
  'Allied_Quote_Revision_2.txt': {
    filename: 'Allied_Quote_Revision_2.txt',
    supplier: 'Allied PET Containers (SUP-A)',
    title: 'Allied Revised Quotation (Clarification Reply A-REPLY-002)',
    content: `Message-ID: A-REPLY-002
In-Reply-To: A-CLARIFY-001
Supplier: Allied PET Containers (SUP-A)
Quote Number: ALL-Q-2026-041-REV2
Date: 2026-09-29

Commercial Terms:
Freight is INR 22,000 for Chennai and INR 26,000 for Bengaluru, excluding GST, each charged once for a single consolidated shipment to that factory whenever any quantity is awarded.
Payment Terms: Net 45 days from delivery.
Validity: Through 2026-10-28.
Arrival: Committed arrival by 2026-10-25 for order accepted 2026-09-30.

Item Quotations:
1. Line BTL-009: PET Bottle 500 ml Heavy Duty Hot-Fill
   Quantity: 115,000 EA | Unit Price: INR 3.30 per EA (Revised downwards from 3.40) | MOQ: 10,000 EA | Lead time: 25 days
2. Line BTL-008: PET Bottle 500 ml Standard Mineral
   Quantity: 130,000 EA | Unit Price: INR 3.05 per EA | MOQ: 10,000 EA | Lead time: 25 days
3. Line CTN-003: Carton 24 x 500ml Master Shipper (5-ply)
   Quantity: 45,000 EA | Unit Price: INR 22.10 per EA | MOQ: 5,000 EA | Lead time: 20 days

Stated Total Goods Value: INR 1,770,500 (Excluding Freight & GST).
Lab Test Report DEMO-A-PET-01 attached: result PASS.`,
  },
  'PrimePack_Commercial_Supplement.txt': {
    filename: 'PrimePack_Commercial_Supplement.txt',
    supplier: 'PrimePack Containers Limited (SUP-B)',
    title: 'PrimePack Commercial Supplement (Volume Rebate & Freight)',
    content: `Supplier: PrimePack Containers Limited (SUP-B)
Quote Reference: PCL 2026 041
Date: 2026-09-28

Commercial Proposal:
Freight: INR 18,000 for Chennai and INR 21,000 for Bengaluru per consolidated factory shipment.
Payment Terms: Net 30 from receipt.
Validity: Valid through 2026-10-19 inclusive.
Volume Discount: A 3% discount applies to bottle goods value only, conditional upon all 20 bottle lines being awarded in full and aggregate goods value before discount and freight is strictly greater than INR 5,000,000.

Quoted Lines:
1. BTL-001: PET Bottle 60 ml Round (3% rebate tier)
   Quantity: 65,000 EA | Price: INR 1.78 per EA | MOQ: 10,000 EA | Lead time: 3 weeks
2. BTL-008: PET Bottle 500 ml Standard Mineral
   Quantity: 130,000 EA | Price: INR 2.98 per EA | MOQ: 10,000 EA | Lead time: 25 days
3. CTN-004: Carton 12 x 1000ml Master Shipper
   Quantity: 55,000 EA | Price: INR 24.80 per EA | MOQ: 5,000 EA | Lead time: 20 days

Stated Total Value: INR 1,906,100 (Including Freight, before applicable 3% rebate).`,
  },
  'Crystal_PET_AllInclusive_Proposal.txt': {
    filename: 'Crystal_PET_AllInclusive_Proposal.txt',
    supplier: 'Crystal PET India (SUP-F)',
    title: 'Crystal PET DDP Landed Proposal (3 Quoted Items)',
    content: `Crystal PET India Master Proposal (SUP-F)
Quote Number: CRY-Q-2026-041
Date: 2026-09-28

Commercial Terms:
All prices are INR per EA, excluding GST.
Freight is INCLUDED for both destinations (Bengaluru Whitefield & Chennai Sriperumbudur) also for partial awards meeting MOQ.
No tooling, packing, setup or other charges; no discounts.
Payment terms: Net 45 days from receipt.
Price validity: Through 2026-10-28. Committed arrival by 2026-10-25.

Lines:
1. BTL-008: PET Bottle 500 ml Standard Mineral (DDP Landed)
   Quantity: 130,000 EA | Unit Price: INR 3.10 / EA | MOQ: 10,000 EA | Lead time: 25 days
2. BTL-009: PET Bottle 500 ml Heavy Duty Hot-Fill (DDP Landed)
   Quantity: 115,000 EA | Unit Price: INR 3.75 / EA | MOQ: 10,000 EA | Lead time: 25 days
3. CTN-003: Carton 24 x 500ml Master Shipper (5-ply DDP)
   Quantity: 45,000 EA | Unit Price: INR 22.40 / EA | MOQ: 5,000 EA | Lead time: 20 days

Stated Grand Total: INR 1,842,250 (All-inclusive DDP).`,
  },
  'SouthPack_Incomplete_Quote.txt': {
    filename: 'SouthPack_Incomplete_Quote.txt',
    supplier: 'SouthPack Industries (SUP-E)',
    title: 'SouthPack Incomplete Quote (UOM Variance & Cash Advance)',
    content: `Quotation from SouthPack Industries (SUP-E)
Date: 2026-09-28

Offer Details:
Item 1: PET Bottles quoted at INR 118 per kg.
Item 2: Master Cartons quoted at INR 1,650 per 100 pcs. Lead time: 1 month.

Payment Terms: 30% advance cash required with purchase order, balance on dispatch.
Freight Terms: Freight extra from warehouse at actuals.
Food Contact Test Report: DEMO-E-PET-01 (Result: Migration test FAIL).
Note: No validity date specified.`,
  },
};

app.get('/api/sample-files', (req, res) => {
  const list = Object.values(SAMPLE_QUOTE_FILES).map((f) => ({
    filename: f.filename,
    supplier: f.supplier,
    title: f.title,
    size: f.content.length,
  }));
  list.unshift({ filename: 'Unit_Clarification_Full_Quote.txt', supplier: 'Based on an eligible full-scope sample supplier',
    title: '30-item quote · clarify price per kg', size: 0 });
  res.json({ files: list });
});

app.get('/api/sample-files/:filename/download', async (req, res) => {
  const { filename } = req.params;
  if (filename === 'Unit_Clarification_Full_Quote.txt') {
    const [source] = await runQuery(`SELECT q.quote_id, q.rfx_id, s.name AS supplier_name
      FROM quotes q JOIN suppliers s ON s.supplier_id = q.supplier_id
      WHERE q.status = 'sample_ready_for_review' AND s.status = 'active'
      AND (SELECT COUNT(*) FROM quote_lines ql WHERE ql.quote_id = q.quote_id) =
          (SELECT COUNT(*) FROM rfx_lines rl WHERE rl.rfx_id = q.rfx_id)
      ORDER BY q.stated_total_amount ASC LIMIT 1;`);
    if (!source) return res.status(404).json({ error: 'No full-scope sample quote is available.' });
    const rows = await runQuery(`SELECT rl.sku_code, i.item_name, ql.quoted_quantity, ql.normalized_unit_price,
      ql.moq_quantity, ql.lead_time_days, ql.delivery_date, i.category
      FROM quote_lines ql JOIN rfx_lines rl ON rl.rfx_line_id = ql.rfx_line_id
      JOIN items i ON i.item_id = rl.item_id WHERE ql.quote_id = ? ORDER BY rl.sku_code;`, [source.quote_id]);
    const target = rows.find((row) => row.category === 'PET Bottles');
    if (!target) return res.status(404).json({ error: 'No bottle item is available for the unit demo.' });
    const ratePerKg = 118;
    const confirmedGrams = 28; // Only the downloadable demo and its example reply know this value.
    const statedTotal = rows.reduce((sum, row) => sum + Number(row.quoted_quantity) *
      (row.sku_code === target.sku_code ? ratePerKg * confirmedGrams / 1000 : Number(row.normalized_unit_price)), 0);
    const content = `Supplier: ${source.supplier_name}\nRFQ: ${source.rfx_id}\nQuote number: UNIT-DEMO-${Date.now()}\nQuote date: ${new Date().toISOString().slice(0, 10)}\nCurrency: INR\nPayment terms: Net 45 days\nValidity: through 2026-11-15\nFreight: included for Bengaluru and Chennai, zero additional charge.\nAll line quantities are EA. All item specifications are confirmed.\nThe price basis for ${target.sku_code} is per kg; unit weight is not stated in this quote and must be confirmed with us.\n\nLine items:\n${rows.map((row) => `${row.sku_code} | ${row.item_name} | Quantity ${row.quoted_quantity} EA | Price INR ${row.sku_code === target.sku_code ? ratePerKg.toFixed(2) + ' per kg' : Number(row.normalized_unit_price).toFixed(2) + ' per EA'} | MOQ ${row.moq_quantity} EA | Lead time ${row.lead_time_days} days | Delivery ${row.delivery_date || '2026-10-25'} | Specification confirmed`).join('\n')}\n\nStated total: INR ${statedTotal.toFixed(2)}.\n`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'text/plain');
    return res.send(content);
  }
  const sample = SAMPLE_QUOTE_FILES[filename];
  if (!sample) {
    return res.status(404).json({ error: 'Sample file not found' });
  }

  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', 'text/plain');
  res.send(sample.content);
});

// -------------------------------------------------------------
// Vite Middleware & Server Initialization
// -------------------------------------------------------------
async function startServer() {
  // Ensure SQLite database is loaded and verified on boot
  await getDb();

  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(process.cwd(), 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.join(process.cwd(), 'dist', 'index.html'));
    });
  }

  app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
    console.log(`Database persistence active at: ${path.join(process.cwd(), 'data', 'procurement.sqlite')}`);
  });
}

startServer();
