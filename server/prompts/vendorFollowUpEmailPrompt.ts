/**
 * Prompt Template for Generating Vendor Follow-Up Emails
 * 
 * Used when a vendor's submitted quote has missing details, ambiguous terms,
 * unconfirmed pricing tiers, or unstated freight/quality compliance certificates.
 * 
 * File: server/prompts/vendorFollowUpEmailPrompt.ts
 */

export interface VendorFollowUpItem {
  fieldName: string;
  rawValue?: string;
  status: 'missing_needs_follow_up' | 'needs_confirmation';
  reason: string;
  evidenceSnippet?: string;
}

export interface VendorFollowUpEmailParams {
  supplierName: string;
  supplierCode: string;
  quoteNumber: string;
  quoteDate?: string;
  rfxId?: string;
  requisitions?: string[];
  plants?: string[];
  missingDetails: VendorFollowUpItem[];
  buyerNotes?: string;
}

export function buildVendorFollowUpEmailPrompt(params: VendorFollowUpEmailParams): string {
  const {
    supplierName,
    supplierCode,
    quoteNumber,
    quoteDate,
    rfxId,
    requisitions = [],
    plants = [],
    missingDetails,
    buyerNotes,
  } = params;

  const missingList = missingDetails.map((item, idx) => {
    return `${idx + 1}. ${item.fieldName}
   - Buyer review note: ${item.reason}
   ${item.rawValue ? `- Supplier's wording: "${item.rawValue}"` : '- No value was provided'}
   ${item.evidenceSnippet ? `- Supporting excerpt: "${item.evidenceSnippet}"` : ''}`;
  }).join('\n\n');

  return `
You are a buyer drafting a clear, courteous follow-up email to a supplier.

The supplier has submitted a quotation. The buyer needs clarification on the points below before comparing offers.

### Context:
- Supplier: ${supplierName} (${supplierCode})
- Vendor Quote Reference: ${quoteNumber}
- Quote Date: ${quoteDate || 'Recent Submission'}
${rfxId ? `- Sourcing Event: ${rfxId}` : ''}
${requisitions.length > 0 ? `- Covered Requisitions: ${requisitions.join(', ')}` : ''}
${plants.length > 0 ? `- Destination Facilities: ${plants.join(', ')}` : ''}

### Points to Clarify:
${missingList}

${buyerNotes ? `### Specific Buyer Guidance to Include:\n${buyerNotes}\n` : ''}

### Email Drafting Requirements:
1. **Subject Line**: Professional, structured, and urgent. Format:
   "Subject: Clarification Request: Quote ${quoteNumber}${rfxId ? ` (${rfxId})` : ''}"
2. **Salutation**: Professional greeting to the ${supplierName} Commercial / Sales Team.
3. **Acknowledgment**: Thank them for quote ${quoteNumber}.
4. **Actionable Checklist**: Ask clear questions about the missing or unclear points. Use the review notes as internal context; do not repeat internal analysis jargon to the supplier.
   - For a quote-total or commercial-value review, use one generic request: ask the supplier to review and confirm the quoted prices, quantities, and stated total. Do not propose a corrected item, price, or calculation.
5. **Clear Next Step**: Ask them to reply with the requested details. Do not invent a deadline.
6. **Tone**: Courteous, concise, and natural for a business buyer. Never say "parsed", "mathematically reconciled", "normalized", "ingested", "LLM", "SQLite", "database", or "automated evaluation".
7. **Sign-Off**: Sign off from "Sourcing Team".

Generate ONLY the final email content with Subject line and Body. Do not add conversational prefixes or meta explanations.
`.trim();
}
