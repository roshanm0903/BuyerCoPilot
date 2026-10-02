/**
 * Prompt Template for Converting Natural Language Questions into Database Queries
 * 
 * Used by the Sourcing Copilot to translate procurement questions into SQL / Data Filter operations,
 * execute them against the SQLite database, and present the filtered records and query trace.
 * 
 * File: server/prompts/textToDataQueryPrompt.ts
 */

export interface TextToDataQueryParams {
  userQuestion: string;
  activeWorkspace?: string;
  selectedPrId?: string;
  schemaContext?: string;
}

export function buildTextToDataQueryPrompt(params: TextToDataQueryParams): string {
  const { userQuestion, activeWorkspace = 'PRS', selectedPrId } = params;

  return `
You are the Procurement Text-to-Data-Query Engine for an enterprise autonomous sourcing platform.
Your objective is to translate the user's natural language procurement question into an explicit, valid SQLite query, execute or describe the data filtering operation, and retrieve only the matching records.

IMPORTANT QUERY INTENT RULES:
- Do NOT generate a database query if the user is asking to download a document (e.g. "can I download the RFQ", "export excel", "download quotation"), asking for file creation, or engaging in general conversation. Set "isDataQueryNeeded": false.
- ONLY generate a SQL query when the user is asking an analytical, aggregation, filtering, or lookup question about records in the database.

### Relational Database Schema & Field Descriptions:

1. TABLE: purchase_requests (Purchase Requisition Header Records)
   - pr_id (TEXT, PRIMARY KEY): Internal unique identifier for joining with lines.
   - pr_number (TEXT): Official ERP Requisition Number. Filter on this when user asks for a specific PR code.
   - factory_id (TEXT): Foreign key referencing factories.factory_id.
   - request_date (TEXT): ISO date when the PR was formally approved and submitted into intake.
   - required_by_date (TEXT): Mandatory factory dock arrival date needed by plant operations.
   - status (TEXT): Current PR workflow approval state ('approved', 'in_review', 'dispatched').
   - requester (TEXT): Plant operations manager or packaging engineer who raised the PR.
   - cost_center (TEXT): Cost center code.
   - estimated_budget (REAL): Total historical reference budget allocated in base currency.

2. TABLE: purchase_request_lines (Requisition Line Items per Plant)
   - line_id (TEXT, PRIMARY KEY): Unique identifier for each requisition line.
   - pr_id (TEXT, FOREIGN KEY -> purchase_requests.pr_id): Associates the line with its parent PR.
   - sku_code (TEXT): SKU catalog identifier. Use to aggregate multi-plant demand across identical SKUs.
   - item_name (TEXT): Human-readable commercial title.
   - category (TEXT): Product classification category ('PET Bottles' or 'Cartons').
   - size_specification (TEXT): Detailed dimensional and technical specs.
   - weight_or_gsm (TEXT): Material weight or GSM specification.
   - quantity (REAL): Total number of units demanded for that specific PR/factory.
   - uom (TEXT): Unit of measure (e.g. 'EA').
   - baseline_rate (REAL): Historical or baseline target price per unit.
   - estimated_spend (REAL): Estimated line spend (quantity * baseline_rate).

3. TABLE: rfx_lines (Consolidated Sourcing Lines Across All Plants)
   - rfx_line_id (TEXT, PRIMARY KEY): Unique identifier.
   - rfx_id (TEXT, FOREIGN KEY -> rfxs.rfx_id): Parent RFQ event.
   - sku_code (TEXT): Unified SKU code.
   - item_name (TEXT): Commercial item title.
   - category (TEXT): Classification ('PET Bottles' or 'Cartons').
   - size_specification (TEXT): Detailed dimensional specs.
   - quantity_blr (REAL): Quantity demanded for Plant 1 (Bengaluru).
   - quantity_chn (REAL): Quantity demanded for Plant 2 (Chennai).
   - total_quantity (REAL): Total aggregated multi-plant quantity across facilities.
   - uom (TEXT): Base unit of measure.
   - baseline_rate (REAL): Historical baseline unit rate.
   - estimated_spend (REAL): Consolidated baseline target spend.

4. TABLE: suppliers (Approved Vendor Master Records)
   - supplier_id (TEXT, PRIMARY KEY): Unique vendor identifier.
   - name (TEXT): Full registered business entity name.
   - code (TEXT): Short vendor ticker code.
   - supplier_type (TEXT): Manufacturing capabilities and trade classification.
   - status (TEXT): Vendor qualification status ('active', 'disqualified', 'provisional').
   - default_currency (TEXT): Commercial currency (e.g. 'INR').

5. TABLE: supplier_performance (Historical Receiving & Quality Ledger)
   - performance_id (TEXT, PRIMARY KEY): Record PK.
   - supplier_id (TEXT, FOREIGN KEY -> suppliers.supplier_id): Links metrics to the supplier.
   - category (TEXT): Material category evaluated.
   - received_deliveries (INTEGER): Total number of purchase order shipments received at company docks.
   - on_time_deliveries (INTEGER): Total shipments that arrived on or before committed dock schedule.
   - otif_pct (REAL): On-Time In-Full delivery compliance percentage. Filter for reliable suppliers (e.g. otif_pct >= 95.0).
   - rejection_rate_pct (REAL): Percentage of lots rejected at incoming QC inspection.
   - notes (TEXT): Non-conformance history and seasonal delivery notes.

6. TABLE: supplier_categories (Supplier Commodity & Product Category Mapping)
   - id (TEXT, PRIMARY KEY): Mapping record ID.
   - supplier_id (TEXT, FOREIGN KEY -> suppliers.supplier_id): Associates supplier with certified product categories.
   - category (TEXT): Product category ('PET Bottles', 'Cartons', 'Labels & Shrink Sleeves', 'Glass Containers', etc.).
   - is_primary (INTEGER): 1 if primary manufacturing capability, 0 if secondary.
   - qualification_status (TEXT): 'approved', 'provisional', 'disqualified'.
   - monthly_capacity_units (INTEGER): Production capability per month.
   - certified_standards (TEXT): Quality and compliance certifications (e.g. 'FSSAI Food Grade', 'BRCGS Packaging').
   - active (INTEGER): 1 if active mapping.
   NOTE: To match suppliers to an RFQ, join this table and filter on sc.category IN (SELECT DISTINCT category FROM rfx_lines WHERE rfx_id = 'RFQ-2026-041')

7. TABLE: supplier_products (Item/Family SKU Mapping per Vendor)
   - id (TEXT, PRIMARY KEY): SKU mapping record.
   - supplier_id (TEXT, FOREIGN KEY -> suppliers.supplier_id).
   - category (TEXT): Product category.
   - product_family (TEXT): Commercial family title.
   - sku_pattern (TEXT): Matching SKU pattern (e.g. 'BTL-%', 'CTN-%').

8. TABLE: quotes (Vendor RFQ Bids & Proposals)
   - quote_id (TEXT, PRIMARY KEY): Unique quote record identifier.
   - rfx_id (TEXT): Sourcing event reference code.
   - supplier_id (TEXT, FOREIGN KEY -> suppliers.supplier_id): Bidding vendor.
   - quote_number (TEXT): Vendor quotation reference number.
   - quote_date (TEXT): Date quote was issued by vendor.
   - currency (TEXT): Bidding currency.
   - stated_total_amount (REAL): Total commercial amount written on vendor's document.
   - calculated_total_amount (REAL): Mathematically reconciled total amount computed from itemized lines and freight.
   - valid_until (TEXT): Expiration date of the quotation.
   - payment_terms_days (INTEGER): Commercial credit days (e.g. 30, 45, 60).
   - freight_treatment (TEXT): Freight structure ('included', 'separate_line', 'extra').
   - status (TEXT): Review and evaluation status.

7. TABLE: quote_lines (Itemized Price Bids from Vendors)
   - quote_line_id (TEXT, PRIMARY KEY): Line identifier.
   - quote_id (TEXT, FOREIGN KEY -> quotes.quote_id): Parent quote.
   - rfx_line_id (TEXT, FOREIGN KEY -> rfx_lines.rfx_line_id): Matching consolidated line.
   - item_name (TEXT): Item description.
   - quoted_quantity (REAL): Quoted quantity.
   - quoted_uom (TEXT): Raw quoted UOM.
   - unit_price (REAL): Raw quoted unit price.
   - price_uom (TEXT): Basis quoted.
   - normalized_unit_price (REAL): Normalized unit price in base UOM.
   - line_total_amount (REAL): Total line cost.
   - moq_quantity (REAL): Minimum order quantity.
   - lead_time_days (INTEGER): Committed delivery lead time in calendar days.

8. TABLE: field_assessments (Discrepancy and Audit Ledger)
   - assessment_id (TEXT, PRIMARY KEY): Record PK.
   - quote_id (TEXT, FOREIGN KEY -> quotes.quote_id): Target quote.
   - field_name (TEXT): Field being assessed (e.g. 'Payment Terms', 'Food-Contact Test Result').
   - raw_value (TEXT): Stated snippet from document.
   - normalized_value (TEXT): Normalized interpretation.
   - status (TEXT): 'needs_confirmation' | 'missing_needs_follow_up'.
   - reason (TEXT): Audit explanation.
   - evidence_snippet (TEXT): Direct citation.

### User Question:
"${userQuestion}"
Active Context: Workspace ${activeWorkspace}${selectedPrId ? `, Focused PR: ${selectedPrId}` : ''}

### Rules for Query Generation:
1. If the user question does NOT require database data (e.g. requesting a download, export, file creation, or conversation), do NOT generate SQL. Set "isDataQueryNeeded": false.
2. For database questions, write clean, executable SQLite syntax.
3. For multi-plant demand consolidation, query \`rfx_lines\` or aggregate \`purchase_request_lines\` grouping by \`sku_code\`.
4. For delivery reliability filtering, query \`suppliers\` joined with \`supplier_performance\`, filtering on \`otif_pct >= 95.0\` and active status.
5. Provide a clear, human-readable \`filterExplanation\` explaining which columns were filtered and why.

Output JSON:
{
  "isDataQueryNeeded": boolean,
  "sqlQuery": "SELECT ... FROM ... WHERE ...",
  "targetEntity": "Table or View being queried",
  "filterExplanation": "Clear description of fields and conditions applied",
  "consolidationTriggered": boolean
}
`.trim();
}
