import type { GoogleGenAI } from '@google/genai';

export interface ShortlistHistoryEntry {
  sender: string;
  text: string;
  supplierShortlist?: { supplierIds: string[]; candidateIds?: string[] };
}

function applyNamedEdits(
  selectedIds: string[],
  turns: string[],
  suppliers: Array<{ supplier_id: string; name: string }>,
): string[] | null {
  const tokenOwners = new Map<string, string[]>();
  for (const supplier of suppliers) {
    for (const token of supplier.name.toLowerCase().match(/[a-z0-9]+/g) || []) {
      if (token.length < 4) continue;
      tokenOwners.set(token, [...new Set([...(tokenOwners.get(token) || []), supplier.supplier_id])]);
    }
  }
  let selection = [...selectedIds];
  let edited = false;
  for (const turn of turns) {
    const lower = turn.toLowerCase();
    const named = suppliers.filter((supplier) =>
      lower.includes(supplier.supplier_id.toLowerCase()) ||
      lower.includes(supplier.name.toLowerCase()) ||
      [...tokenOwners].some(([token, owners]) => owners.length === 1 && owners[0] === supplier.supplier_id && new RegExp(`\\b${token}\\b`).test(lower))
    ).map((supplier) => supplier.supplier_id);
    if (!named.length) continue;
    if (/\b(remove|exclude|drop|without|except)\b|\bdon't send\b|\bdo not send\b/.test(lower)) {
      selection = selection.filter((id) => !named.includes(id));
      edited = true;
    } else if (/\bonly\b/.test(lower)) {
      selection = named;
      edited = true;
    } else if (/\b(add|include)\b/.test(lower)) {
      selection = [...new Set([...selection, ...named])];
      edited = true;
    }
  }
  return edited ? selection : null;
}

/** Resolve references and later shortlist edits without widening the supplier set. */
export async function resolveDispatchRecipients(
  ai: GoogleGenAI | null,
  message: string,
  history: ShortlistHistoryEntry[],
  eligibleSupplierIds: string[],
  selectedSupplierIds: string[] = eligibleSupplierIds,
  supplierNames: Array<{ supplier_id: string; name: string }> = [],
): Promise<string[]> {
  if (!ai) throw new Error('Gemini is unavailable to resolve dispatch recipients');
  if (!eligibleSupplierIds.length) throw new Error('No eligible suppliers remain in the shortlist');

  const response = await ai.models.generateContent({
    model: 'gemini-3.1-flash-lite',
    contents: `You resolve the selected suppliers for a procurement conversation. Return only JSON matching the schema. The allowed candidates with exact name-to-ID mappings are ${JSON.stringify(supplierNames)}. Allowed candidate IDs: ${JSON.stringify(eligibleSupplierIds)}. Currently selected IDs: ${JSON.stringify(selectedSupplierIds)}. Match a supplier mentioned by name to its exact ID from the mappings; never substitute another supplier. Read subsequent conversation turns in order and apply additions or removals within allowed candidates. For "suppliers identified above" or "the shortlist", use the current selection after those changes. If the user names a subset, use only that subset. Never add an ID outside the allowed candidates. If the request is ambiguous or the resulting set is empty, return an empty list. Do not claim to send anything.\n\nConversation since shortlist: ${JSON.stringify(history.map((h) => ({ sender: h.sender, text: h.text.slice(0, 2000) })))}\nCurrent request: ${JSON.stringify(message)}`,
    config: {
      responseMimeType: 'application/json',
      responseJsonSchema: {
        type: 'object',
        properties: { supplierIds: { type: 'array', items: { type: 'string', enum: eligibleSupplierIds } } },
        required: ['supplierIds'],
        additionalProperties: false,
      },
      temperature: 0,
    },
  });

  let parsed: unknown;
  try { parsed = JSON.parse(response.text || ''); }
  catch { throw new Error('Gemini returned invalid RFQ recipients'); }
  const ids = (parsed as { supplierIds?: unknown })?.supplierIds;
  if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string' && eligibleSupplierIds.includes(id))) {
    throw new Error('Gemini returned recipients outside the shortlist');
  }
  const explicitSelection = applyNamedEdits(
    selectedSupplierIds,
    [...history.filter((entry) => entry.sender === 'user').map((entry) => entry.text), message],
    supplierNames,
  );
  return explicitSelection ?? [...new Set(ids)];
}
