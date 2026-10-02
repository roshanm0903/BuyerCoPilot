import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import type { GoogleGenAI } from '@google/genai';
import { resolveDispatchRecipients } from './dispatchRecipients';

const modelReturning = (text: string) => ({
  models: { generateContent: async () => ({ text }) },
}) as unknown as GoogleGenAI;

test('keeps follow-up recipient choices inside the prior shortlist', async () => {
  const ids = await resolveDispatchRecipients(
    modelReturning('{"supplierIds":["SUP-O","SUP-M","SUP-B"]}'),
    'Send the RFQ to those suppliers',
    [{ sender: 'user', text: 'Remove PrimePack from the shortlist' }],
    ['SUP-O', 'SUP-M', 'SUP-B'],
    ['SUP-O', 'SUP-M', 'SUP-B'],
    [
      { supplier_id: 'SUP-O', name: 'Alpha-Pack Integrated Systems' },
      { supplier_id: 'SUP-M', name: 'Zenith Rigid Polymers' },
      { supplier_id: 'SUP-B', name: 'PrimePack Containers Limited' },
    ],
  );
  assert.deepEqual(ids, ['SUP-O', 'SUP-M']);
});

test('rejects recipients outside the shortlist and invalid model output', async () => {
  await assert.rejects(
    resolveDispatchRecipients(modelReturning('{"supplierIds":["SUP-A"]}'), 'Send it', [], ['SUP-O']),
    /outside the shortlist/,
  );
  await assert.rejects(
    resolveDispatchRecipients(modelReturning('not json'), 'Send it', [], ['SUP-O']),
    /invalid RFQ recipients/,
  );
});
