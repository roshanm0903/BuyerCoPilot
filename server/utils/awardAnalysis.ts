import { runQuery } from '../db';
import { formatInr } from './procurementEvidence';
import type { AnalysisKind } from './copilotRouter';

type RfqLine = { rfx_line_id: string; sku_code: string; item_name: string; category: string; quantity_blr: number; quantity_chn: number; total_quantity: number; baseline_rate: number };
type QuoteLine = { quote_line_id: string; quote_id: string; rfx_line_id: string; normalized_unit_price: number; quoted_quantity: number; moq_quantity: number | null; lead_time_days: number | null; delivery_date: string | null; specification_status: string };
type Bid = { quote_id: string; quote_number: string; supplier_id: string; supplier_name: string; supplier_code: string; quote_status: string; stated_total_amount: number; valid_until: string | null; payment_terms_days: number | null; freight_treatment: string; supplier_status: string; otif_pct: number | null; lines: Map<string, QuoteLine>; capacities: Map<string, { category_capacity: number | null; product_capacity: number | null; lead_days: number | null; qualification_status: string; certified_standards: string | null }> };
export type AwardAllocation = { rfx_line_id: string; supplier_id: string; quantity_blr: number; quantity_chn: number };
export type AwardPlan = { rfx_id: string; label: string; allocations: AwardAllocation[] };
export type AwardComparisonChart = {
  title: string;
  rows: Array<{ label: string; value: number; note?: string }>;
  presentation?: 'spend-comparison' | 'waterfall';
  savings?: number;
  savingsPercent?: number;
  budgetDiscrepancy?: { prBudget: number; prCount: number; referenceSpend: number };
};
type Context = { rfxId: string; dueDate: string; lines: RfqLine[]; bids: Bid[]; baseline: number; prBudget: number; prCount: number; asOf: string };
type PlanCheck = { cost: number; issues: string[]; categoryUsage: Array<{ supplier: Bid; category: string; quantity: number; capacity: number | null }> };

const qty = (value: number) => new Intl.NumberFormat('en-IN').format(value);
const money = (value: number) => formatInr(Math.round(value * 100) / 100);
const cell = (value: unknown) => String(value ?? '—').replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');
const table = (headers: string[], rows: unknown[][]) => `| ${headers.join(' | ')} |\n| ${headers.map(() => '---').join(' | ')} |\n${rows.map((row) => `| ${row.map(cell).join(' | ')} |`).join('\n')}`;
const daysUntil = (date: string, asOf: string) => Math.floor((Date.parse(`${date}T23:59:59Z`) - Date.parse(`${asOf}T00:00:00Z`)) / 86_400_000);
const leadDays = (bid: Bid, category: string, line: QuoteLine) => Math.max(Number(line.lead_time_days || 0), Number(bid.capacities.get(category)?.lead_days || 0));
const capacityFor = (bid: Bid, category: string) => {
  const row = bid.capacities.get(category);
  if (!row || row.category_capacity == null || row.product_capacity == null) return null;
  return Math.min(row.category_capacity, row.product_capacity);
};
const bidLink = (bid: Bid) => `[${bid.quote_number}](#quote=${encodeURIComponent(bid.quote_id)})`;

export async function loadAwardContext(rfxId: string, readyQuoteIds: string[], now = new Date()): Promise<Context> {
  const [rfq] = await runQuery('SELECT rfx_id FROM rfxs WHERE rfx_id = ?;', [rfxId]);
  if (!rfq) throw new Error(`RFQ ${rfxId} was not found`);
  const lines = await runQuery(`SELECT l.rfx_line_id, i.sku_code, i.item_name, i.category,
    l.quantity_blr, l.quantity_chn, l.total_quantity, l.baseline_rate
    FROM rfx_lines l JOIN items i ON i.item_id = l.item_id
    WHERE l.rfx_id = ? ORDER BY i.sku_code;`, [rfxId]) as RfqLine[];
  const [dateRow] = await runQuery(`SELECT MIN(pr.required_by_date) AS due_date
    FROM purchase_requests pr JOIN purchase_request_lines pl ON pl.pr_id = pr.pr_id
    WHERE pl.item_id IN (SELECT item_id FROM rfx_lines WHERE rfx_id = ?);`, [rfxId]);
  const dueDate = String(dateRow?.due_date || '');
  if (!lines.length || !dueDate) throw new Error(`RFQ ${rfxId} has no linked demand or delivery date`);
  const [budgetRow] = await runQuery(`SELECT COALESCE(SUM(pl.estimated_spend), 0) AS total_budget,
      COUNT(DISTINCT pl.pr_id) AS pr_count
    FROM purchase_request_lines pl
    WHERE pl.item_id IN (SELECT item_id FROM rfx_lines WHERE rfx_id = ?);`, [rfxId]);
  const prBudget = Number(budgetRow?.total_budget || 0);
  const prCount = Number(budgetRow?.pr_count || 0);
  const selectedIds = [...new Set(readyQuoteIds)];
  if (!selectedIds.length) return { rfxId, dueDate, lines, bids: [], baseline: lines.reduce((sum, line) => sum + line.total_quantity * line.baseline_rate, 0), prBudget, prCount, asOf: now.toISOString().slice(0, 10) };
  const placeholders = selectedIds.map(() => '?').join(', ');
  const allQuoteRows = await runQuery(`SELECT q.*, s.name AS supplier_name, s.code AS supplier_code,
    s.status AS supplier_status, p.otif_pct
    FROM quotes q JOIN suppliers s ON s.supplier_id = q.supplier_id
    LEFT JOIN supplier_performance p ON p.supplier_id = s.supplier_id
    WHERE q.rfx_id = ? AND q.quote_id IN (${placeholders}) ORDER BY q.quote_date DESC, q.quote_id DESC;`, [rfxId, ...selectedIds]);
  // A newer complete submission supersedes earlier submissions from the same supplier.
  const quoteRows = allQuoteRows.filter((quote, index) => allQuoteRows.findIndex((item) => item.supplier_id === quote.supplier_id) === index);
  const lineRows = await runQuery(`SELECT quote_line_id, quote_id, rfx_line_id, normalized_unit_price,
    quoted_quantity, moq_quantity, lead_time_days, delivery_date, specification_status
    FROM quote_lines WHERE quote_id IN (${placeholders});`, selectedIds) as QuoteLine[];
  const capacityRows = await runQuery(`SELECT sc.supplier_id, sc.category, sc.monthly_capacity_units AS category_capacity,
    sc.lead_time_days, sc.qualification_status, sc.certified_standards,
    MIN(CASE WHEN p.active = 1 AND p.qualification_status = 'approved' THEN p.monthly_capacity_units END) AS product_capacity
    FROM supplier_categories sc LEFT JOIN supplier_products p
      ON p.supplier_id = sc.supplier_id AND p.category = sc.category
    WHERE sc.active = 1 AND sc.supplier_id IN (${quoteRows.map(() => '?').join(', ')})
    GROUP BY sc.supplier_id, sc.category;`, quoteRows.map((quote) => quote.supplier_id));
  const bids: Bid[] = quoteRows.map((quote) => ({
    quote_id: quote.quote_id, quote_number: quote.quote_number,
    supplier_id: quote.supplier_id, supplier_name: quote.supplier_name, supplier_code: quote.supplier_code,
    quote_status: quote.status, stated_total_amount: Number(quote.stated_total_amount),
    valid_until: quote.valid_until, payment_terms_days: quote.payment_terms_days,
    freight_treatment: quote.freight_treatment, supplier_status: quote.supplier_status,
    otif_pct: quote.otif_pct == null ? null : Number(quote.otif_pct),
    lines: new Map(lineRows.filter((line) => line.quote_id === quote.quote_id).map((line) => [line.rfx_line_id, line])),
    capacities: new Map(capacityRows.filter((row) => row.supplier_id === quote.supplier_id).map((row) => [row.category, {
      category_capacity: row.category_capacity == null ? null : Number(row.category_capacity),
      product_capacity: row.product_capacity == null ? null : Number(row.product_capacity),
      lead_days: row.lead_time_days == null ? null : Number(row.lead_time_days),
      qualification_status: row.qualification_status, certified_standards: row.certified_standards,
    }])),
  }));
  return { rfxId, dueDate, lines, bids, baseline: lines.reduce((sum, line) => sum + line.total_quantity * line.baseline_rate, 0), prBudget, prCount, asOf: now.toISOString().slice(0, 10) };
}

function fullPlan(ctx: Context, bid: Bid): AwardPlan {
  return { rfx_id: ctx.rfxId, label: `All items to ${bid.supplier_name}`, allocations: ctx.lines.map((line) => ({
    rfx_line_id: line.rfx_line_id, supplier_id: bid.supplier_id,
    quantity_blr: line.quantity_blr, quantity_chn: line.quantity_chn,
  })) };
}

function splitPlan(ctx: Context): AwardPlan | null {
  const categories = [...new Set(ctx.lines.map((line) => line.category))];
  const candidates: AwardPlan[] = [];
  for (const primary of ctx.bids) for (const secondary of ctx.bids) {
    if (primary.supplier_id === secondary.supplier_id) continue;
    for (const alternateCategory of categories) {
      const plan: AwardPlan = { rfx_id: ctx.rfxId,
        label: `${primary.supplier_name} primary; ${secondary.supplier_name} for ${alternateCategory}`,
        allocations: ctx.lines.map((line) => ({ rfx_line_id: line.rfx_line_id,
          supplier_id: line.category === alternateCategory ? secondary.supplier_id : primary.supplier_id,
          quantity_blr: line.quantity_blr, quantity_chn: line.quantity_chn })) };
      if (checkPlan(ctx, plan).issues.length === 0) candidates.push(plan);
    }
  }
  return candidates.sort((a, b) => checkPlan(ctx, a).cost - checkPlan(ctx, b).cost)[0] || null;
}

function proportionalSplitPlan(ctx: Context, first: Bid, second: Bid, firstShare: number): AwardPlan {
  return { rfx_id: ctx.rfxId, label: `${firstShare}% ${first.supplier_name} / ${100 - firstShare}% ${second.supplier_name}`,
    allocations: ctx.lines.flatMap((line) => {
      const firstBlr = Math.round(line.quantity_blr * firstShare / 100);
      const firstChn = Math.round(line.quantity_chn * firstShare / 100);
      return [
        { rfx_line_id: line.rfx_line_id, supplier_id: first.supplier_id, quantity_blr: firstBlr, quantity_chn: firstChn },
        { rfx_line_id: line.rfx_line_id, supplier_id: second.supplier_id,
          quantity_blr: line.quantity_blr - firstBlr, quantity_chn: line.quantity_chn - firstChn },
      ];
    }) };
}

function minimumLineShare(ctx: Context, bid: Bid): number {
  return Math.max(...ctx.lines.map((line) => (bid.lines.get(line.rfx_line_id)?.moq_quantity || 0) / line.total_quantity));
}

export function checkPlan(ctx: Context, plan: AwardPlan): PlanCheck {
  const issues: string[] = [];
  const usage = new Map<string, { supplier: Bid; category: string; quantity: number; capacity: number | null }>();
  const totals = new Map<string, { blr: number; chn: number }>();
  let cost = 0;
  if (plan.rfx_id !== ctx.rfxId) issues.push('Allocation belongs to a different RFQ');
  for (const allocation of plan.allocations) {
    const line = ctx.lines.find((item) => item.rfx_line_id === allocation.rfx_line_id);
    const bid = ctx.bids.find((item) => item.supplier_id === allocation.supplier_id);
    if (!line || !bid) { issues.push(`Unknown RFQ line or supplier: ${allocation.rfx_line_id}`); continue; }
    const quoteLine = bid.lines.get(line.rfx_line_id);
    if (!quoteLine) { issues.push(`${line.sku_code}: no quote line from ${bid.supplier_name}`); continue; }
    const quantity = Number(allocation.quantity_blr) + Number(allocation.quantity_chn);
    if (!Number.isInteger(quantity) || quantity <= 0 || allocation.quantity_blr < 0 || allocation.quantity_chn < 0) issues.push(`${line.sku_code}: invalid allocated quantity`);
    if (quantity > Number(quoteLine.quoted_quantity)) issues.push(`${line.sku_code}: allocation exceeds quoted quantity`);
    if (quoteLine.moq_quantity != null && quantity < quoteLine.moq_quantity) issues.push(`${line.sku_code}: allocation below ${bid.supplier_name} MOQ ${qty(quoteLine.moq_quantity)}`);
    if (quoteLine.delivery_date && quoteLine.delivery_date > ctx.dueDate) issues.push(`${line.sku_code}: quoted delivery after ${ctx.dueDate}`);
    if (leadDays(bid, line.category, quoteLine) > daysUntil(ctx.dueDate, ctx.asOf)) issues.push(`${line.sku_code}: lead time misses ${ctx.dueDate}`);
    if (quoteLine.specification_status !== 'confirmed') issues.push(`${line.sku_code}: specification not confirmed`);
    const current = totals.get(line.rfx_line_id) || { blr: 0, chn: 0 };
    current.blr += Number(allocation.quantity_blr); current.chn += Number(allocation.quantity_chn);
    totals.set(line.rfx_line_id, current);
    const key = `${bid.supplier_id}:${line.category}`;
    const used = usage.get(key) || { supplier: bid, category: line.category, quantity: 0, capacity: capacityFor(bid, line.category) };
    used.quantity += quantity;
    usage.set(key, used);
    cost += quantity * Number(quoteLine.normalized_unit_price);
  }
  for (const line of ctx.lines) {
    const total = totals.get(line.rfx_line_id);
    if (!total || total.blr !== line.quantity_blr || total.chn !== line.quantity_chn) issues.push(`${line.sku_code}: allocation does not reconcile to both plants`);
  }
  for (const row of usage.values()) {
    if (row.capacity == null) issues.push(`${row.supplier.supplier_name}: ${row.category} capacity not recorded`);
    else if (row.quantity > row.capacity) issues.push(`${row.supplier.supplier_name}: ${row.category} ${qty(row.quantity)} exceeds recorded monthly capacity ${qty(row.capacity)}`);
    if (row.supplier.capacities.get(row.category)?.qualification_status !== 'approved') issues.push(`${row.supplier.supplier_name}: ${row.category} not approved`);
    if (row.supplier.valid_until && row.supplier.valid_until < ctx.asOf) issues.push(`${row.supplier.supplier_name}: quote validity expired`);
    if (row.supplier.supplier_status !== 'active') issues.push(`${row.supplier.supplier_name}: supplier not active`);
    if (!row.supplier.payment_terms_days || !row.supplier.freight_treatment) issues.push(`${row.supplier.supplier_name}: payment or freight terms missing`);
  }
  return { cost: Math.round(cost * 100) / 100, issues: [...new Set(issues)], categoryUsage: [...usage.values()] };
}

function selectedPlan(ctx: Context, priorPlan?: AwardPlan): AwardPlan | null {
  if (priorPlan && priorPlan.rfx_id === ctx.rfxId && checkPlan(ctx, priorPlan).issues.length === 0) return priorPlan;
  return splitPlan(ctx);
}

function evidence(ctx: Context): string {
  const links = ctx.bids.map((bid) => `${bid.supplier_name}: ${bidLink(bid)}`).join(' · ');
  return `**Review the source records:** [RFQ item schedule](/api/rfq/excel) · ${links}. Open a quote link to inspect its original submission, line prices, MOQ, delivery, terms, and supplier capacity records. Recorded monthly capacity is not confirmed free capacity, and sample quote terms are not independently verified supplier commitments.`;
}

function allocationTable(ctx: Context, plan: AwardPlan, includeReason = false): string {
  const rows = plan.allocations.map((allocation) => {
    const line = ctx.lines.find((item) => item.rfx_line_id === allocation.rfx_line_id)!;
    const bid = ctx.bids.find((item) => item.supplier_id === allocation.supplier_id)!;
    const price = bid.lines.get(line.rfx_line_id)!.normalized_unit_price;
    const alternativePrices = ctx.bids.filter((other) => other.supplier_id !== bid.supplier_id)
      .map((other) => other.lines.get(line.rfx_line_id)?.normalized_unit_price).filter((value): value is number => value != null);
    const priceReason = alternativePrices.length && price <= Math.min(...alternativePrices) ? 'lowest quoted line price; ' : '';
    const reason = `${priceReason}${bid.otif_pct ?? 'Unknown'}% historical OTIF; ${line.category} capacity ${capacityFor(bid, line.category) == null ? 'unknown' : qty(capacityFor(bid, line.category)!)} / month`;
    return includeReason
      ? [line.sku_code, line.item_name, bid.supplier_name, qty(allocation.quantity_blr), qty(allocation.quantity_chn), money(price), money((allocation.quantity_blr + allocation.quantity_chn) * price), reason]
      : [line.sku_code, bid.supplier_name, qty(allocation.quantity_blr), qty(allocation.quantity_chn), money(price), money((allocation.quantity_blr + allocation.quantity_chn) * price)];
  });
  return includeReason
    ? table(['SKU', 'RFQ item', 'Supplier', 'Bengaluru EA', 'Chennai EA', 'Unit price', 'Line total', 'Reason / evidence'], rows)
    : table(['SKU', 'Supplier', 'Bengaluru EA', 'Chennai EA', 'Unit price', 'Line total'], rows);
}

export function answerAwardQuestion(ctx: Context, kind: AnalysisKind, priorPlan?: AwardPlan, question = ''): { reply: string; awardPlan?: AwardPlan; sourceQuoteIds: string[]; comparisonChart?: AwardComparisonChart } | null {
  if (!ctx.bids.length) return { reply: `No complete quotes are available for ${ctx.rfxId}. Review the Supplier Inbox before calculating an award.`, sourceQuoteIds: [] };
  const singles = ctx.bids.map((bid) => ({ bid, plan: fullPlan(ctx, bid) })).map((entry) => ({ ...entry, check: checkPlan(ctx, entry.plan) }));
  const cheapest = singles.filter((entry) => entry.check.issues.length === 0).sort((a, b) => a.check.cost - b.check.cost)[0];
  const split = splitPlan(ctx);
  const splitCheck = split ? checkPlan(ctx, split) : null;
  const chosen = selectedPlan(ctx, priorPlan);
  const chosenCheck = chosen ? checkPlan(ctx, chosen) : null;
  const sources = ctx.bids.map((bid) => bid.quote_id);
  const sourceText = evidence(ctx);

  if (kind === 'negotiation') {
    const normalizedQuestion = question.toLowerCase().replace(/[^a-z0-9]/g, '');
    const named = ctx.bids.filter((bid) => {
      const full = bid.supplier_name.toLowerCase().replace(/[^a-z0-9]/g, '');
      const first = bid.supplier_name.split(/\s+/)[0].toLowerCase().replace(/[^a-z0-9]/g, '');
      return normalizedQuestion.includes(full) || (first.length > 3 && normalizedQuestion.includes(first));
    });
    const bid = named.length === 1 ? named[0] : ctx.bids.length === 1 ? ctx.bids[0] : null;
    if (!bid) return { reply: `Which supplier should I prepare the negotiation message for? Please name one supplier from the complete quotes for ${ctx.rfxId}.`, sourceQuoteIds: [] };
    const ownQuotedTotal = ctx.lines.reduce((sum, line) => sum + line.total_quantity * Number(bid.lines.get(line.rfx_line_id)?.normalized_unit_price || 0), 0);
    const explicitTarget = question.match(/(?:₹|INR\s*)([\d,]+(?:\.\d{1,2})?)/i)?.[1];
    const target = explicitTarget ? Number(explicitTarget.replace(/,/g, '')) : Math.round(ownQuotedTotal * 0.98 * 100) / 100;
    if (!Number.isFinite(target) || target <= 0) return { reply: 'Please provide a valid target price for the negotiation.', sourceQuoteIds: [] };
    return { reply: `### Negotiation draft for ${bid.supplier_name}\n\n**Target price:** ${money(target)} for the full quoted RFQ scope. ${explicitTarget ? 'This is the target you provided.' : 'This proposed target is 2% below this supplier’s own quoted line total.'}\n\n> Dear ${bid.supplier_name} Team,\n>\n> Thank you for your quotation ${bid.quote_number} for ${ctx.rfxId}. We are targeting **${money(target)}** for the full quoted scope. Can you match this price?\n>\n> Please send a revised quotation confirming the item prices, delivery dates, validity, and commercial terms.\n>\n> Kind regards,\n> Sourcing Team\n\nDraft only; no message was sent. [Review this supplier’s quote](#quote=${encodeURIComponent(bid.quote_id)}) before using the target.`, sourceQuoteIds: [bid.quote_id] };
  }

  if (kind === 'baseline_savings') {
    const priorIsValid = priorPlan?.rfx_id === ctx.rfxId && checkPlan(ctx, priorPlan).issues.length === 0;
    const plan = priorIsValid ? priorPlan : cheapest?.plan || chosen;
    if (!plan) return { reply: `No feasible award allocation is available for ${ctx.rfxId}, so savings against the RFQ baseline cannot yet be calculated.\n\n${sourceText}`, sourceQuoteIds: sources };
    const planCost = checkPlan(ctx, plan).cost;
    const savings = Math.round((ctx.baseline - planCost) * 100) / 100;
    const savingsPercent = ctx.baseline ? (savings / ctx.baseline) * 100 : 0;
    const reference = priorIsValid ? 'Current conversation allocation' : 'Lowest-cost feasible reference allocation (no award selected in this conversation)';
    const resultLabel = savings >= 0 ? 'Savings' : 'Increase over baseline';
    const hasBudgetDiscrepancy = Math.abs(ctx.baseline - ctx.prBudget) > 0.01;
    const budgetNote = hasBudgetDiscrepancy
      ? `\n\n> **Budget control required:** The combined budget across ${ctx.prCount} linked purchase requests is ${money(ctx.prBudget)}, while the RFQ reference spend is ${money(ctx.baseline)}. Resolve the governing spend baseline before approving an award.`
      : '';
    return {
      reply: `### Award spend check for ${ctx.rfxId}\n\n${reference}: **${plan.label}**.\n\n**${resultLabel}: ${money(Math.abs(savings))} (${Math.abs(savingsPercent).toFixed(2)}% of RFQ reference spend).** Taxes and other quote costs not recorded in the quote lines are excluded.${budgetNote}\n\n${sourceText}`,
      awardPlan: priorIsValid ? plan : undefined,
      sourceQuoteIds: sources,
      comparisonChart: { title: 'RFQ reference spend and proposed award', presentation: 'waterfall', savings, savingsPercent,
        budgetDiscrepancy: hasBudgetDiscrepancy ? { prBudget: ctx.prBudget, prCount: ctx.prCount, referenceSpend: ctx.baseline } : undefined,
        rows: [
        { label: 'RFQ reference spend', value: ctx.baseline },
        { label: 'Proposed award', value: planCost },
      ] },
    };
  }

  if (kind === 'price_comparison') {
    if (ctx.bids.length < 2) return { reply: `Only one complete quote is available for ${ctx.rfxId}; a line-by-line comparison needs another complete bid.\n\n${sourceText}`, sourceQuoteIds: sources };
    const askedBids = ctx.bids.filter((bid) => {
      const name = bid.supplier_name.toLowerCase();
      const firstWord = name.split(/\s+/)[0];
      const lowerQuestion = question.toLowerCase();
      return lowerQuestion.includes(name) || (firstWord.length > 3 && lowerQuestion.includes(firstWord)) || lowerQuestion.includes(bid.supplier_code.toLowerCase());
    });
    const [a, b] = askedBids.length === 2 ? askedBids : ctx.bids.slice(0, 2);
    const rows = ctx.lines.map((line) => {
      const pa = a.lines.get(line.rfx_line_id)!.normalized_unit_price;
      const pb = b.lines.get(line.rfx_line_id)!.normalized_unit_price;
      const cheaper = pa === pb ? 'Tie' : pa < pb ? a.supplier_name : b.supplier_name;
      return [line.sku_code, line.item_name, qty(line.total_quantity), money(pa), money(pb), cheaper, money(Math.abs(pa - pb) * line.total_quantity)];
    });
    const lowerEach = ctx.lines.reduce((sum, line) => sum + line.total_quantity * Math.min(a.lines.get(line.rfx_line_id)!.normalized_unit_price, b.lines.get(line.rfx_line_id)!.normalized_unit_price), 0);
    const higherFull = Math.max(singles.find((entry) => entry.bid.quote_id === a.quote_id)!.check.cost, singles.find((entry) => entry.bid.quote_id === b.quote_id)!.check.cost);
    return { reply: `### Line-price comparison for ${ctx.rfxId}\n\n${table(['SKU', 'RFQ item', 'Demand EA', `${a.supplier_name} / EA`, `${b.supplier_name} / EA`, 'Cheaper quote', 'Line saving vs higher price'], rows)}\n\nChoosing the lower quoted price on every SKU totals **${money(lowerEach)}**. That saves **${money(higherFull - lowerEach)}** versus awarding every line to the higher-total bid. Compare feasibility before using that combination as an award.\n\n${sourceText}`, sourceQuoteIds: sources,
      comparisonChart: { title: 'Full-demand quoted cost', rows: [a, b].map((bid) => ({ label: bid.supplier_name, value: singles.find((entry) => entry.bid.quote_id === bid.quote_id)!.check.cost })) } };
  }

  if (kind === 'delivery_risk') {
    const categoryRows = [...new Set(ctx.lines.map((line) => line.category))].flatMap((category) => ctx.bids.map((bid) => {
      const demand = ctx.lines.filter((line) => line.category === category).reduce((sum, line) => sum + line.total_quantity, 0);
      const capacity = capacityFor(bid, category);
      return [bid.supplier_name, category, qty(demand), capacity == null ? 'Unknown' : qty(capacity), capacity == null ? 'Unverified' : capacity >= demand ? 'Within recorded monthly capacity' : 'Full-category demand exceeds capacity', `${bid.otif_pct ?? 'Unknown'}%`];
    }));
    const itemRows = ctx.lines.map((line) => [line.sku_code, line.item_name, qty(line.quantity_blr), qty(line.quantity_chn), ...ctx.bids.map((bid) => {
      const quoteLine = bid.lines.get(line.rfx_line_id)!;
      const cap = capacityFor(bid, line.category);
      const lead = leadDays(bid, line.category, quoteLine);
      const flags = [cap == null ? 'Capacity unknown' : cap < ctx.lines.filter((item) => item.category === line.category).reduce((sum, item) => sum + item.total_quantity, 0) ? 'Category capacity short' : null,
        lead > daysUntil(ctx.dueDate, ctx.asOf) ? 'Lead time late' : null,
        quoteLine.delivery_date && quoteLine.delivery_date > ctx.dueDate ? 'Quoted date late' : null].filter(Boolean);
      return `${lead} days; ${quoteLine.delivery_date || 'date missing'}; ${flags.join(', ') || 'No recorded timing gap'}`;
    })]);
    return { reply: `### Full-demand delivery check for ${ctx.rfxId}\n\nRequired arrival: **${ctx.dueDate}**. Available from ${ctx.asOf}: **${daysUntil(ctx.dueDate, ctx.asOf)} days**.\n\n${table(['Supplier', 'Category', 'Demand EA', 'Recorded monthly capacity EA', 'Full-scope check', 'Historical OTIF'], categoryRows)}\n\n${table(['SKU', 'RFQ item', 'BLR EA', 'CHN EA', ...ctx.bids.map((bid) => bid.supplier_name)], itemRows)}\n\nThis is a screening check. Recorded capacity is nominal monthly capacity; neither available production slots nor delivery commitments have been independently reconfirmed.\n\n${sourceText}`, sourceQuoteIds: sources };
  }

  if (kind === 'single_award') {
    const rows = singles.map(({ bid, check }) => [bid.supplier_name, money(check.cost), `${bid.otif_pct ?? 'Unknown'}%`, '100%', check.issues.length ? check.issues.join('; ') : 'Passes recorded line, term, capacity, and date checks']);
    return { reply: `### Single-supplier award comparison for ${ctx.rfxId}\n\n${table(['Supplier', 'Full-demand cost', 'Historical OTIF', 'Supplier share', 'Constraint result'], rows)}\n\nBaseline from RFQ line rates: **${money(ctx.baseline)}**. A single award places all ${qty(ctx.lines.reduce((sum, line) => sum + line.total_quantity, 0))} units with one supplier. Capacity remains a recorded monthly figure, not confirmed free capacity.\n\n${sourceText}`, sourceQuoteIds: sources,
      comparisonChart: { title: 'Full-demand single-supplier cost', rows: singles.map(({ bid, check }) => ({ label: bid.supplier_name, value: check.cost, note: check.issues.length ? 'Has recorded exception' : 'Passes recorded checks' })) } };
  }

  if (kind === 'split_award') {
    const asksEqualSplit = /\b50\s*(?:%\s*)?(?:\/|-|:|to)\s*50\s*%?\b|\b50\s*%\s*(?:each|apiece)\b/i.test(question);
    if (asksEqualSplit) {
      if (ctx.bids.length !== 2) return { reply: `I need exactly two complete supplier quotes to test a 50/50 split. Please name the two suppliers.\n\n${sourceText}`, sourceQuoteIds: sources };
      const [higherMoq, other] = [...ctx.bids].sort((a, b) => minimumLineShare(ctx, b) - minimumLineShare(ctx, a));
      const equalPlan = proportionalSplitPlan(ctx, higherMoq, other, 50);
      const equalCheck = checkPlan(ctx, equalPlan);
      if (!equalCheck.issues.length) return { reply: `### 50/50 split check for ${ctx.rfxId}\n\nThe split passes the recorded quote, MOQ, capacity, and delivery checks.\n\n${allocationTable(ctx, equalPlan)}\n\n**Total:** ${money(equalCheck.cost)}.\n\n${sourceText}`, awardPlan: equalPlan, sourceQuoteIds: sources };
      const moqRows = ctx.lines.flatMap((line) => {
        const allocation = equalPlan.allocations.find((row) => row.rfx_line_id === line.rfx_line_id && row.supplier_id === higherMoq.supplier_id)!;
        const allocated = allocation.quantity_blr + allocation.quantity_chn;
        const minimum = higherMoq.lines.get(line.rfx_line_id)?.moq_quantity || 0;
        return allocated < minimum ? [[line.sku_code, higherMoq.supplier_name, qty(allocated), qty(minimum)]] : [];
      });
      const feasible = Array.from({ length: 49 }, (_, index) => index + 51)
        .map((share) => ({ share, plan: proportionalSplitPlan(ctx, higherMoq, other, share) }))
        .find(({ plan }) => checkPlan(ctx, plan).issues.length === 0);
      if (!feasible) return { reply: `### 50/50 split is not feasible for ${ctx.rfxId}\n\n${moqRows.length ? `${moqRows.length} lines fall below ${higherMoq.supplier_name}'s recorded minimum order.\n\n${table(['SKU', 'Supplier', '50% allocation EA', 'Quoted MOQ EA'], moqRows.slice(0, 10))}\n\n` : ''}Other recorded constraints: ${equalCheck.issues.join('; ')}. No proportional split from 51% through 99% for ${higherMoq.supplier_name} passes all recorded checks.\n\n${sourceText}`, sourceQuoteIds: sources };
      const revisedCheck = checkPlan(ctx, feasible.plan);
      return { reply: `### 50/50 split check for ${ctx.rfxId}\n\n**A 50/50 item-by-item split does not meet ${higherMoq.supplier_name}'s quoted minimum orders.** ${moqRows.length} of ${ctx.lines.length} items fall below its MOQ.\n\n${table(['SKU', 'Supplier', '50% allocation EA', 'Quoted MOQ EA'], moqRows.slice(0, 6))}\n\nThe smallest whole-percentage proportional split that passes the recorded checks is **${feasible.share}% to ${higherMoq.supplier_name} and ${100 - feasible.share}% to ${other.supplier_name}** for each item.\n\n${allocationTable(ctx, feasible.plan)}\n\n**Proposed total:** ${money(revisedCheck.cost)}. Each plant and SKU quantity reconciles to the RFQ. Please confirm the suppliers' available capacity and acceptance of this split before awarding.\n\n${sourceText}`,
        awardPlan: feasible.plan, sourceQuoteIds: sources,
        comparisonChart: { title: 'Equal split and MOQ-compliant split', rows: [
          { label: '50/50 (fails MOQ)', value: equalCheck.cost, note: `${moqRows.length} MOQ exceptions` },
          { label: `${feasible.share}/${100 - feasible.share} (passes recorded checks)`, value: revisedCheck.cost },
        ] } };
    }
    if (!split || !splitCheck) return { reply: `No two-supplier category split passes the current quote, capacity, MOQ, and delivery checks for ${ctx.rfxId}. Specify a minimum share or request a line-level exception review.\n\n${sourceText}`, sourceQuoteIds: sources };
    const highestSingle = Math.max(...singles.map((entry) => entry.check.cost));
    const lowestFeasible = cheapest?.check.cost;
    return { reply: `### Proposed two-supplier allocation for ${ctx.rfxId}\n\n**${split.label}.** This is the lowest-cost feasible category split among the complete quotes.\n\n${allocationTable(ctx, split)}\n\n**Split total:** ${money(splitCheck.cost)}. It saves **${money(highestSingle - splitCheck.cost)}** against the higher-cost full bid${lowestFeasible == null ? '' : `, and costs **${money(splitCheck.cost - lowestFeasible)}** more than the lowest-cost feasible single award`}. Bengaluru and Chennai quantities reconcile to the RFQ lines.\n\n${sourceText}`, awardPlan: split, sourceQuoteIds: sources,
      comparisonChart: { title: 'Award option cost', rows: [...singles.map(({ bid, check }) => ({ label: `All to ${bid.supplier_name}`, value: check.cost, note: check.issues.length ? 'Has recorded exception' : undefined })), { label: 'Proposed two-supplier split', value: splitCheck.cost, note: 'Passes recorded checks' }] } };
  }

  if (kind === 'reliability_tradeoff') {
    if (!chosen || !chosenCheck) return { reply: `I need a feasible allocation before comparing reliability for ${ctx.rfxId}.\n\n${sourceText}`, sourceQuoteIds: sources };
    const reliable = singles.filter((entry) => entry.check.issues.length === 0).sort((a, b) => (b.bid.otif_pct ?? -1) - (a.bid.otif_pct ?? -1))[0];
    if (!reliable) return { reply: `No complete single-supplier quote passes current feasibility checks for ${ctx.rfxId}. A reliability-first change needs capacity confirmation.\n\n${sourceText}`, sourceQuoteIds: sources };
    const changed = ctx.lines.filter((line) => chosen.allocations.find((a) => a.rfx_line_id === line.rfx_line_id)?.supplier_id !== reliable.bid.supplier_id);
    const rows = changed.map((line) => {
      const from = ctx.bids.find((bid) => bid.supplier_id === chosen.allocations.find((a) => a.rfx_line_id === line.rfx_line_id)!.supplier_id)!;
      const oldPrice = from.lines.get(line.rfx_line_id)!.normalized_unit_price;
      const newPrice = reliable.bid.lines.get(line.rfx_line_id)!.normalized_unit_price;
      const lineDelta = (newPrice - oldPrice) * line.total_quantity;
      return [line.sku_code, from.supplier_name, reliable.bid.supplier_name, qty(line.total_quantity), lineDelta < 0 ? `Saves ${money(-lineDelta)}` : lineDelta > 0 ? `Adds ${money(lineDelta)}` : 'No change'];
    });
    const delta = reliable.check.cost - chosenCheck.cost;
    const movedQuantity = changed.reduce((sum, line) => sum + line.total_quantity, 0);
    const movedFrom = [...new Set(changed.map((line) => chosen.allocations.find((a) => a.rfx_line_id === line.rfx_line_id)?.supplier_id))]
      .map((id) => ctx.bids.find((bid) => bid.supplier_id === id)).filter((bid): bid is Bid => Boolean(bid));
    const comparison = movedFrom.length === 1 && movedFrom[0].otif_pct != null && reliable.bid.otif_pct != null
      ? `Historical OTIF on the moved lines changes from **${movedFrom[0].otif_pct}% to ${reliable.bid.otif_pct}%** (${(reliable.bid.otif_pct - movedFrom[0].otif_pct).toFixed(1)} percentage points).`
      : 'Historical OTIF differs by supplier; review the source performance records for the moved lines.';
    return { reply: `### Reliability-first tradeoff for ${ctx.rfxId}\n\nReference plan: **${chosen.label}** (${money(chosenCheck.cost)}). Highest recorded OTIF among feasible full-scope bidders: **${reliable.bid.supplier_name} (${reliable.bid.otif_pct}%)**.\n\n${changed.length ? table(['SKU', 'Current supplier', 'Reliability-first supplier', 'EA moved', 'Cost effect'], rows) : 'No item allocation changes: the current plan already uses the highest-OTIF feasible supplier throughout.'}\n\n**${qty(movedQuantity)} EA across ${changed.length} SKUs move.** ${comparison} **Cost change:** ${delta > 0 ? `increase of ${money(delta)}` : delta < 0 ? `decrease of ${money(-delta)}` : money(0)}. The new plan places 100% of demand with one supplier, increasing concentration risk. OTIF does not guarantee a delivery result.\n\n${sourceText}`, awardPlan: reliable.plan, sourceQuoteIds: sources };
  }

  if (kind === 'constraints') {
    if (!chosen || !chosenCheck) return { reply: `No feasible proposed allocation is available for ${ctx.rfxId}.\n\n${sourceText}`, sourceQuoteIds: sources };
    const usedBids = ctx.bids.filter((bid) => chosen.allocations.some((allocation) => allocation.supplier_id === bid.supplier_id));
    const rows = chosenCheck.categoryUsage.map((row) => [row.supplier.supplier_name, row.category, qty(row.quantity), row.capacity == null ? 'Unknown' : qty(row.capacity), row.capacity != null && row.quantity <= row.capacity ? 'Within recorded capacity' : 'Review']);
    const terms = usedBids.map((bid) => [bid.supplier_name, bid.valid_until || 'Missing', bid.payment_terms_days == null ? 'Missing' : `Net ${bid.payment_terms_days} days`, bid.freight_treatment, `${bid.otif_pct ?? 'Unknown'}%`]);
    return { reply: `### Allocation constraints for ${ctx.rfxId}\n\nChecked plan: **${chosen.label}**. Arrival deadline: **${ctx.dueDate}**.\n\n${table(['Supplier', 'Category', 'Allocated EA', 'Recorded monthly capacity EA', 'Check'], rows)}\n\n${table(['Supplier', 'Quote valid to', 'Payment', 'Freight', 'Historical OTIF'], terms)}\n\n**Line-level MOQ, quoted quantity, lead time, delivery date, specification, and plant reconciliation:** ${chosenCheck.issues.length ? chosenCheck.issues.join('; ') : `No recorded exceptions across ${ctx.lines.length} RFQ lines`}.\n\nNominal monthly capacity is not confirmed free capacity. Obtain written capacity and delivery confirmation before placing an order.\n\n${sourceText}`, awardPlan: chosen, sourceQuoteIds: sources };
  }

  if (kind === 'recommendation') {
    if (!cheapest) return { reply: `No single-supplier quote passes all recorded award checks for ${ctx.rfxId}. Confirm capacity or revise the allocation before recommending an award.\n\n${sourceText}`, sourceQuoteIds: sources };
    const plan = cheapest.plan;
    const blr = ctx.lines.reduce((sum, line) => sum + line.quantity_blr, 0);
    const chn = ctx.lines.reduce((sum, line) => sum + line.quantity_chn, 0);
    return { reply: `### Provisional award recommendation for ${ctx.rfxId}\n\nThe lowest-cost feasible recorded allocation is **${cheapest.bid.supplier_name} for every RFQ line**. Its historical OTIF is ${cheapest.bid.otif_pct}%. This avoids the recorded capacity gaps in other full-scope bids, but concentrates supply with one supplier. If dual sourcing is required, use the category split at **${splitCheck ? money(splitCheck.cost) : 'no feasible split recorded'}** and accept its cost difference.\n\n${allocationTable(ctx, plan, true)}\n\n**Reconciliation:** Bengaluru **${qty(blr)} EA** + Chennai **${qty(chn)} EA** = **${qty(blr + chn)} EA** across ${ctx.lines.length} SKUs. Sum of awarded line extensions: **${money(cheapest.check.cost)}**; quoted full-scope total: **${money(cheapest.bid.stated_total_amount)}**; difference: **${money(Math.abs(cheapest.check.cost - cheapest.bid.stated_total_amount))}**. RFQ baseline: **${money(ctx.baseline)}**.\n\nThis is a review recommendation, not an order or verified supplier commitment. Confirm available capacity and delivery in writing.\n\n${sourceText}`, awardPlan: plan, sourceQuoteIds: sources };
  }

  return null;
}
