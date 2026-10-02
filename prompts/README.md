# LLM Prompts Directory (`/server/prompts/`)

This folder contains all the segregated prompt templates used by the AI engine. You can directly edit any file here to adjust the LLM's personality, extraction accuracy, negotiation strategy, or domain rules.

---

## Files in this Directory

| File | Primary Use Case | When to Edit |
|------|------------------|--------------|
| **`sourcingCopilotPrompt.ts`** | Core System Prompt for the interactive Copilot chat | To change supplier facts, add new factory rules, update PR baseline figures, or adjust conversational tone. |
| **`documentExtractionPrompt.ts`** | Unstructured document parsing & SQLite schema mapping | To add new extracted fields, change confidence scoring criteria, or customize UOM conversions. |
| **`negotiationPlaybookPrompt.ts`** | Sourcing negotiation & counter-offer drafts | To tune supplier bargaining leverage, target margin calculations, or discount requests. |
| **`clarificationDeskPrompt.ts`** | Vendor inquiry drafting for missing/ambiguous fields | To change clarification email wording or required attachment policies. |

---

## How Prompts are Consumed in `server.ts`

```typescript
import { 
  SOURCING_SYSTEM_PROMPT, 
  buildDocumentParsingPrompt 
} from './server/prompts';

// In AI Copilot chat route:
const response = await ai.models.generateContent({
  model: 'gemini-flash-latest',
  contents: userMessage,
  config: {
    systemInstruction: SOURCING_SYSTEM_PROMPT,
  }
});

// In Document Ingestion route:
const extractionPrompt = buildDocumentParsingPrompt({
  content: documentText,
  filename: uploadedFile.name,
  supplierId: 'SUP-A'
});
```
