import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import type { GoogleGenAI } from '@google/genai';
import { routeCopilotMessage, ROUTER_MODEL } from './copilotRouter';

function modelReturning(text: string, calls: unknown[]) {
  return {
    models: {
      generateContent: async (request: unknown) => {
        calls.push(request);
        return { text };
      },
    },
  } as GoogleGenAI;
}

test('uses Gemini structured output before choosing a chat path', async () => {
  const calls: unknown[] = [];
  const result = await routeCopilotMessage(
    modelReturning('{"route":"supplier_list","analysisKind":"other"}', calls),
    'List all suppliers',
    [{ sender: 'user', text: 'I am on the PR page' }],
    'Workspace: PRS',
  );
  assert.equal(result.route, 'supplier_list');
  assert.equal(result.analysisKind, 'other');
  assert.equal(result.model, ROUTER_MODEL);
  assert.equal(calls.length, 1);
  const request = calls[0] as { contents: string; config: { responseMimeType: string; responseJsonSchema: unknown } };
  assert.equal(request.config.responseMimeType, 'application/json');
  assert.ok(request.config.responseJsonSchema);
  assert.ok(request.contents.includes('Current user message: "List all suppliers"'));
});

test('does not guess a route when Gemini is unavailable or returns invalid output', async () => {
  await assert.rejects(routeCopilotMessage(null, 'hi'), /not configured/);
  const calls: unknown[] = [];
  await assert.rejects(routeCopilotMessage(modelReturning('{"route":"made_up","analysisKind":"other"}', calls), 'hi'), /unsupported/);
  await assert.rejects(routeCopilotMessage(modelReturning('not json', calls), 'hi'), /invalid/);
});

test('supplier demand-fit requests have a distinct LLM route', async () => {
  const calls: unknown[] = [];
  const result = await routeCopilotMessage(
    modelReturning('{"route":"supplier_fit","analysisKind":"other"}', calls),
    'Get me the suppliers who can meet demand for the two purchase requests',
  );
  assert.equal(result.route, 'supplier_fit');
  assert.ok((calls[0] as { contents: string }).contents.includes('supplier_fit:'));
});

test('quote completeness question is classified by the LLM node', async () => {
  const calls: unknown[] = [];
  const result = await routeCopilotMessage(
    modelReturning('{"route":"procurement_data","analysisKind":"quote_eligibility"}', calls),
    'Which suppliers have a complete quote for all RFQ items?',
    [],
    'Workspace: PRS',
  );
  assert.equal(result.analysisKind, 'quote_eligibility');
  assert.ok((calls[0] as { contents: string }).contents.includes('quote_eligibility'));
});

test('retries transient model overload before routing', async () => {
  let calls = 0;
  const model = { models: { generateContent: async () => {
    calls += 1;
    if (calls === 1) throw new Error('{"error":{"code":503,"status":"UNAVAILABLE"}}');
    return { text: '{"route":"procurement_data","analysisKind":"recommendation"}' };
  } } } as unknown as GoogleGenAI;
  const result = await routeCopilotMessage(model, 'Recommend an award');
  assert.equal(result.analysisKind, 'recommendation');
  assert.equal(calls, 2);
});
