import type { GoogleGenAI } from '@google/genai';
import { COPILOT_ROUTING_PROMPT } from '../prompts/copilotRoutingPrompt';

export const COPILOT_ROUTES = [
  'greeting', 'help', 'supplier_list', 'supplier_fit', 'supplier_selection', 'demand_consolidation', 'rfq_download', 'rfq_dispatch',
  'procurement_data', 'general',
] as const;

export type CopilotRoute = typeof COPILOT_ROUTES[number];
export const ANALYSIS_KINDS = [
  'quote_eligibility', 'price_comparison', 'baseline_savings', 'delivery_risk', 'single_award',
  'split_award', 'reliability_tradeoff', 'constraints', 'recommendation', 'negotiation', 'other',
] as const;
export type AnalysisKind = typeof ANALYSIS_KINDS[number];
export const ROUTER_MODEL = 'gemini-3.1-flash-lite';

export interface RoutingResult {
  route: CopilotRoute;
  analysisKind: AnalysisKind;
  model: string;
  latencyMs: number;
}

/** Gemini is the routing node. An unavailable or invalid result must not execute a guessed path. */
export async function routeCopilotMessage(
  ai: GoogleGenAI | null,
  message: string,
  history: Array<{ sender: string; text: string }> = [],
  context = '',
): Promise<RoutingResult> {
  if (!ai) throw new Error('Gemini is not configured for chat routing');

  const started = Date.now();
  const conversation = history.slice(-4).map((entry) => ({
    role: entry.sender === 'user' ? 'user' : 'assistant',
    text: String(entry.text || '').slice(0, 1000),
  }));
  const request = {
    model: ROUTER_MODEL,
    contents: `${COPILOT_ROUTING_PROMPT}\n\nWorkspace: ${context || 'unspecified'}\nRecent conversation: ${JSON.stringify(conversation)}\nCurrent user message: ${JSON.stringify(message)}`,
    config: {
      responseMimeType: 'application/json',
      responseJsonSchema: {
        type: 'object',
        properties: {
          route: { type: 'string', enum: [...COPILOT_ROUTES] },
          analysisKind: { type: 'string', enum: [...ANALYSIS_KINDS] },
        },
        required: ['route', 'analysisKind'],
        additionalProperties: false,
      },
      temperature: 0,
    },
  } as const;
  let response: Awaited<ReturnType<typeof ai.models.generateContent>> | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      response = await ai.models.generateContent(request);
      break;
    } catch (error) {
      const message = String((error as Error)?.message || error);
      if (attempt === 2 || !/("code":503|"code":429|UNAVAILABLE|RESOURCE_EXHAUSTED|high demand)/i.test(message)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 300 * 2 ** attempt));
    }
  }
  if (!response) throw new Error('Gemini returned no chat route');

  let parsed: unknown;
  try {
    parsed = JSON.parse(response.text || '');
  } catch {
    throw new Error('Gemini returned an invalid chat route');
  }
  const route = (parsed as { route?: unknown })?.route;
  const analysisKind = (parsed as { analysisKind?: unknown })?.analysisKind;
  if (!COPILOT_ROUTES.includes(route as CopilotRoute)) {
    throw new Error('Gemini returned an unsupported chat route');
  }
  if (!ANALYSIS_KINDS.includes(analysisKind as AnalysisKind)) {
    throw new Error('Gemini returned an unsupported analysis kind');
  }

  return { route: route as CopilotRoute, analysisKind: analysisKind as AnalysisKind, model: ROUTER_MODEL, latencyMs: Math.max(1, Date.now() - started) };
}
