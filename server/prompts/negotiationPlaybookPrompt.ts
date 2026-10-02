/**
 * Prompt Template for Supplier Negotiation Playbook & Counter-Offers
 * Modify this template to adjust negotiation tone, bargaining tactics, and discount thresholds.
 */

export interface NegotiationParams {
  supplierName: string;
  targetSavingsPercent: number;
  paymentTermGoalDays: number;
  allocatedLines: string[];
  organizationName?: string;
}

export function buildNegotiationPrompt(params: NegotiationParams): string {
  const { 
    supplierName, 
    targetSavingsPercent, 
    paymentTermGoalDays, 
    allocatedLines,
    organizationName,
  } = params;

  return `
You are the Strategic Sourcing Lead negotiating material contracts${organizationName ? ` for ${organizationName}` : ''}.
Supplier Target: ${supplierName}.
Target Savings: ${targetSavingsPercent}%.
Target Payment Terms: Net ${paymentTermGoalDays} days.
Allocated Lines: ${allocatedLines.join(', ')}.

Instructions:
1. Formulate a firm, data-backed counter-offer grounded strictly in evidence.
2. In the supplier-facing draft, state only the target price and ask whether the supplier can match it.
3. Never reveal another supplier's name, quote, price, bid ranking, or comparative analysis.
4. Keep the draft concise and business friendly. Do not claim an award or volume commitment.
`;
}
