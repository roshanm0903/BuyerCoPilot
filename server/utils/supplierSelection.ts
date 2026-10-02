import type { GoogleGenAI } from '@google/genai';
import { runQuery } from '../db';

type Metric = 'otif_pct' | 'rejection_rate_pct';
type Operator = 'gt' | 'gte' | 'lt' | 'lte' | 'eq';
type Intent = { action: 'filter' | 'edit'; metric: Metric | 'none'; operator: Operator | 'none'; value: number };

const operators: Record<Operator, string> = { gt: '>', gte: '>=', lt: '<', lte: '<=', eq: '=' };

/** The model interprets the request; SQLite evaluates the resulting allowlisted predicate. */
export async function interpretSupplierSelection(ai: GoogleGenAI | null, message: string): Promise<Intent> {
  if (!ai) throw new Error('Gemini is unavailable to interpret supplier selection');
  const response = await ai.models.generateContent({
    model: 'gemini-3.1-flash-lite',
    contents: `Interpret this supplier shortlist follow-up. Return only JSON. A numerical historical on-time performance/OTIF or rejection-rate threshold is action filter. Translate "more than" and "above" to gt (strict), "at least" to gte, "less than" and "below" to lt, "at most" to lte. Other requests, including named supplier edits and dispatch, are action edit. Do not infer a threshold that the user did not state. Current request: ${JSON.stringify(message)}`,
    config: {
      responseMimeType: 'application/json',
      responseJsonSchema: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['filter', 'edit'] },
          metric: { type: 'string', enum: ['otif_pct', 'rejection_rate_pct', 'none'] },
          operator: { type: 'string', enum: ['gt', 'gte', 'lt', 'lte', 'eq', 'none'] },
          value: { type: 'number' },
        },
        required: ['action', 'metric', 'operator', 'value'],
        additionalProperties: false,
      },
      temperature: 0,
    },
  });
  const intent = JSON.parse(response.text || '{}') as Intent;
  if (intent.action === 'edit') return { action: 'edit', metric: 'none', operator: 'none', value: 0 };
  if (intent.action !== 'filter' || !['otif_pct', 'rejection_rate_pct'].includes(intent.metric) ||
      !Object.hasOwn(operators, intent.operator) || !Number.isFinite(intent.value) || intent.value < 0 || intent.value > 100) {
    throw new Error('Invalid supplier performance filter');
  }
  return intent;
}

export async function filterSupplierSelection(ids: string[], intent: Intent) {
  if (intent.action !== 'filter' || intent.metric === 'none' || intent.operator === 'none' || !ids.length) return [];
  const placeholders = ids.map(() => '?').join(', ');
  return await runQuery(`SELECT s.supplier_id, s.name, sp.otif_pct, sp.rejection_rate_pct
    FROM suppliers s JOIN supplier_performance sp ON sp.supplier_id = s.supplier_id
    WHERE s.supplier_id IN (${placeholders}) AND sp.${intent.metric} ${operators[intent.operator]} ?
    ORDER BY sp.${intent.metric} DESC, s.name;`, [...ids, intent.value]) as Array<{
      supplier_id: string; name: string; otif_pct: number; rejection_rate_pct: number;
    }>;
}
