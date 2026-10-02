/**
 * Generic AI Document Extraction & Structuring Prompt Template
 * Designed for any RFx, Purchase Requisition, or material procurement category.
 * Completely free of hardcoded requisition numbers, plant codes, or item SKUs.
 *
 * Captures explicit item names, line identifiers, and quote-level total amounts
 * to enable automatic mathematical validation and extraction reconciliation.
 */

export interface DocumentParsingParams {
  content: string;
  filename: string;
  supplierId?: string;
  documentType?: string;
  categoryHint?: string;
}

export function buildDocumentParsingPrompt(params: DocumentParsingParams): string {
  const { content, filename, supplierId, documentType, categoryHint } = params;

  return `
You are an Enterprise AI Procurement Document Extraction Specialist.
Your task is to analyze an incoming supplier response (quote, rate card, email offer, or commercial supplement) and extract all raw commercial, operational, and line-item details with extreme fidelity.

Extraction Guidelines:
1. RAW FIDELITY: Extract stated numbers, currencies, UOMs, and lead time phrases EXACTLY as written. Do not perform manual arithmetic conversions in your head.
2. ITEM NAMES & IDENTIFIERS:
   - Extract 'item_name': The concise, human-readable name of the product (e.g. "PET Bottle 500 ml Hot-Fill", "5-Ply Corrugated Shipper Carton", "BOPP Packing Tape", "Preform 28mm PCO").
   - Extract 'line_identifier': The SKU code, line number, or customer part code if provided (e.g. "BTL-009", "CTN-003", "ITEM-1").
   - Extract 'item_description': The detailed specifications, dimensions, weight, or technical narrative.
3. QUOTE-LEVEL TOTAL AMOUNT (FOR VALIDATION):
   - Extract 'stated_total_amount': The grand total value or subtotal explicitly printed/stated by the supplier in the document (e.g. 5420000). If no total is stated, return null. This is used by the system to mathematically validate the extraction by comparing with the sum of line items.
   - Extract 'raw_line_total': If an extended line total (quantity × unit price) is explicitly printed for a line, extract it.
4. EXPANDED UOMs: Capture whatever Unit of Measure the vendor used across any category:
   - Count / Units: EA, PCS, NOS, UNIT, DOZEN, GROSS, PER 100, PER 1000, SET, PAIR
   - Weight: KG, G, MG, MT (metric ton), TON, QUINTAL, LB, OZ
   - Volume / Liquid: L, ML, KL, GAL, FL OZ, CC
   - Packaging / Containment: BOX, CTN (carton), CASE, BUNDLE, BAG, CRATE, ROLL, PACK, DRUM, CAN, PALLET, BALE
   - Dimension / Area: M, CM, MM, FT, IN, SQM, SQFT, RMT (running meter)
5. RAW LEAD TIME: Extract the raw lead time value (e.g. 3) and raw unit (e.g. "weeks", "months", "business days", "days") as well as the exact source phrase.
   - Extract each line's committed delivery date as YYYY-MM-DD when the document states one. A quote-level date that explicitly applies to every line may be repeated for every line.
6. ACTIONABLE ASSESSMENTS ONLY: Identify fields that have discrepancies, ambiguity, or missing mandatory data. Include ONLY items requiring human review:
   - 'needs_confirmation': Ambiguous pricing, footnote conditions, unusual UOM, mathematical variance, or partial dates.
   - 'missing_needs_follow_up': Mandatory terms absent (e.g. missing freight rate, missing validity date, missing payment terms, missing quality certification).
   (DO NOT include 'confident' items in field_assessments).
   CRITICAL RULE ON UOM CONVERSIONS: DO NOT flag standard mathematical count conversions (such as 'per 100 pcs', 'per 1000', 'per dozen', 'gross' converted to base EA) as needs_confirmation. When you are confident on the conversion, do NOT create any assessment. ONLY flag genuine ambiguities (such as weight-to-piece conversions without a confirmed spec weight, or unstated pricing basis).

Metadata Context:
- Supplier Reference / Code: ${supplierId || 'UNKNOWN_SUPPLIER'}
- Source Document: ${filename} (${documentType || 'quotation'})
${categoryHint ? `- Category Hint: ${categoryHint}` : ''}

Document Text to Analyze:
"""
${content}
"""

Return ONLY a valid, parseable JSON object matching this schema (no markdown formatting, no backticks):
{
  "quote_number": "string (extracted quote/proposal reference or 'NOT_STATED')",
  "supplier_name": "string (vendor or entity name found in document)",
  "quote_date": "string (YYYY-MM-DD or raw date string)",
  "currency": "string (currency code, e.g. INR, USD, EUR)",
  "stated_total_amount": "number or null (grand total or goods subtotal explicitly stated in document)",
  "validity_phrase": "string or null (e.g. 'valid for 30 days', 'valid until 2026-10-28')",
  "payment_terms_phrase": "string or null (e.g. 'Net 30 days', 'Net 45', '30% advance cash')",
  "freight_treatment_raw": "string or null (e.g. 'freight included', 'freight extra at actuals', 'INR 18,000 flat')",
  "freight_entries": [
    {
      "destination_label": "string (delivery location mentioned, e.g. Chennai or Bengaluru)",
      "amount": "number or null",
      "currency": "string",
      "is_included": "boolean (true if explicitly free/included)"
    }
  ],
  "discount_condition": "string or null (e.g. volume rebate, tier condition, or null)",
  "compliance_notes": "string or null (e.g. lab test PASS/FAIL, FSSAI, ISO, or certificate reference)",
  "lines": [
    {
      "line_identifier": "string (SKU code, line number, or item code if present, e.g. BTL-009, CTN-003, ITEM-1)",
      "item_name": "string (concise human-readable product name, e.g. 'PET Bottle 500 ml Hot-Fill')",
      "item_description": "string (full verbatim description/specs)",
      "raw_quoted_quantity": "number or null",
      "raw_quantity_uom": "string (e.g. EA, PCS, KG, BOX, ROLL, MT)",
      "raw_unit_price": "number (quoted numeric price)",
      "raw_price_uom": "string (the exact basis quoted, e.g. 'EA', 'per 100 pcs', 'kg', 'per thousand', 'per dozen')",
      "raw_line_total": "number or null (extended total for this line if stated in document)",
      "raw_moq_value": "number or null",
      "raw_moq_uom": "string (e.g. EA, PCS, KG, BOX)",
      "raw_lead_time_value": "number or null",
      "raw_lead_time_unit": "string ('days' | 'business_days' | 'weeks' | 'months' | 'hours' | 'immediate' | 'not_stated')",
      "raw_lead_time_phrase": "string (e.g. '3 weeks from order confirmation')",
      "specification_status": "string ('confirmed' | 'exception' | 'not_stated')",
      "destination_facility": "string or null",
      "delivery_date": "string (YYYY-MM-DD) or null"
    }
  ],
  "field_assessments": [
    {
      "field_name": "string (e.g. 'Freight Rate', 'Quote Validity', 'Payment Terms', 'Total Amount Variance')",
      "raw_value": "string (verbatim text snippet or 'Not Found')",
      "normalized_value": "string (provisional or derived value)",
      "status": "string (MUST BE EITHER 'needs_confirmation' OR 'missing_needs_follow_up')",
      "reason": "string (why action or confirmation is required)",
      "evidence_snippet": "string (citation quote or reference)"
    }
  ]
}
`;
}
