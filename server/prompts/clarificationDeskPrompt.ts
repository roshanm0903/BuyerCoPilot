/**
 * Prompt Template for Supplier Clarifications
 * Modify this template to adjust missing-field follow-up protocols.
 */

export interface ClarificationParams {
  supplierCode: string;
  missingFields: string[];
  quoteNumber: string;
}

export function buildClarificationPrompt(params: ClarificationParams): string {
  const { supplierCode, missingFields, quoteNumber } = params;

  return `
You are the Procurement Clarification Agent.
Draft a concise, professional clarification request to ${supplierCode} regarding Quote ${quoteNumber}.
Missing/Ambiguous Mandatory Fields:
${missingFields.map((f, i) => `${i + 1}. ${f}`).join('\n')}

Rules:
- Group all open items into ONE clear message.
- Specify requested format (e.g. INR per factory, explicit validity date).
- Reiterate that all supplied prices, MOQs, and existing terms have been retained.
`;
}
