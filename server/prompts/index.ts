/**
 * Central Export for all LLM Prompts in the Sourcing System
 * Modify individual files in this directory to tune specific AI workflows:
 * - sourcingCopilotPrompt.ts: Sourcing assistant persona & business rules
 * - documentExtractionPrompt.ts: Vendor quote parsing & database structuring
 * - negotiationPlaybookPrompt.ts: Counter-offer tactics & target pricing
 * - clarificationDeskPrompt.ts: Missing-info vendor inquiries
 */

export * from './sourcingCopilotPrompt';
export * from './documentExtractionPrompt';
export * from './negotiationPlaybookPrompt';
export * from './clarificationDeskPrompt';
export * from './vendorFollowUpEmailPrompt';
export * from './textToDataQueryPrompt';
export * from './copilotRoutingPrompt';
