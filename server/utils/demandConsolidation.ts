import { runQuery, runTransaction } from '../db';

export const DEMO_RFQ_ID = 'RFQ-2026-041';
export const DEMO_PR_NUMBERS = ['PR-BLR-1088', 'PR-CHN-1045'] as const;

type Pr = { pr_id: string; pr_number: string; factory_id: string; status: string; required_by_date: string; quantity: number; lines: number; baseline: number };
type Line = { item_id: string; sku_code: string; item_name: string; category: string; size_specification: string; weight_or_gsm: string | null;
  quantity_blr: number; quantity_chn: number; total_quantity: number; uom: string; baseline_rate: number; estimated_spend: number };

/** Build the demo RFQ from its two source PRs, or verify the existing RFQ still matches them. */
export async function prepareDemandConsolidation() {
  const prs = await runQuery(`SELECT pr.pr_id, pr.pr_number, pr.factory_id, pr.status, pr.required_by_date,
      COUNT(prl.line_id) AS lines, SUM(prl.quantity) AS quantity, ROUND(SUM(prl.estimated_spend), 2) AS baseline
    FROM purchase_requests pr JOIN purchase_request_lines prl ON prl.pr_id = pr.pr_id
    WHERE pr.pr_number IN (?, ?) GROUP BY pr.pr_id ORDER BY pr.pr_number;`, [...DEMO_PR_NUMBERS]) as Pr[];
  if (prs.length !== 2 || prs.some((pr) => pr.status !== 'approved') ||
      !prs.some((pr) => pr.factory_id === 'BLR') || !prs.some((pr) => pr.factory_id === 'CHN')) {
    throw new Error('Both approved Bengaluru and Chennai purchase requests are required to create this RFQ.');
  }

  const lines = await runQuery(`SELECT i.item_id, i.sku_code, i.item_name, i.category, i.size_specification,
      i.weight_or_gsm, i.uom,
      SUM(CASE WHEN pr.factory_id = 'BLR' THEN prl.quantity ELSE 0 END) AS quantity_blr,
      SUM(CASE WHEN pr.factory_id = 'CHN' THEN prl.quantity ELSE 0 END) AS quantity_chn,
      SUM(prl.quantity) AS total_quantity,
      ROUND(SUM(prl.estimated_spend) / SUM(prl.quantity), 4) AS baseline_rate,
      ROUND(SUM(prl.estimated_spend), 2) AS estimated_spend
    FROM purchase_requests pr JOIN purchase_request_lines prl ON prl.pr_id = pr.pr_id
    JOIN items i ON i.item_id = prl.item_id
    WHERE pr.pr_number IN (?, ?) GROUP BY i.item_id ORDER BY i.category, i.sku_code;`, [...DEMO_PR_NUMBERS]) as Line[];
  if (!lines.length || lines.some((line) => !line.quantity_blr || !line.quantity_chn)) {
    throw new Error('The PR item schedules are incomplete; the RFQ cannot be reconciled.');
  }

  const [existing] = await runQuery('SELECT rfx_id FROM rfxs WHERE rfx_id = ?;', [DEMO_RFQ_ID]);
  let created = false;
  if (!existing) {
    await runTransaction((db) => {
      db.run(`INSERT INTO rfxs (rfx_id, title, issue_date, due_date, currency, buyer_name, status)
        VALUES (?, ?, date('now'), ?, 'INR', 'Strategic Sourcing Team', 'draft');`,
        [DEMO_RFQ_ID, `Packaging requirements (${DEMO_PR_NUMBERS.join(' & ')})`, prs[0].required_by_date]);
      for (const line of lines) {
        db.run(`INSERT INTO rfx_lines (rfx_line_id, rfx_id, item_id, sku_code, item_name, category,
          size_specification, weight_or_gsm, quantity_blr, quantity_chn, total_quantity, uom, baseline_rate, estimated_spend)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`, [
          `RFX-L-${line.sku_code}`, DEMO_RFQ_ID, line.item_id, line.sku_code, line.item_name, line.category,
          line.size_specification, line.weight_or_gsm, line.quantity_blr, line.quantity_chn,
          line.total_quantity, line.uom, line.baseline_rate, line.estimated_spend,
        ]);
      }
    });
    created = true;
  } else {
    const existingLines = await runQuery(`SELECT sku_code, quantity_blr, quantity_chn, total_quantity,
      estimated_spend FROM rfx_lines WHERE rfx_id = ?;`, [DEMO_RFQ_ID]) as Line[];
    const bySku = new Map(existingLines.map((line) => [line.sku_code, line]));
    if (existingLines.length !== lines.length || lines.some((line) => {
      const recorded = bySku.get(line.sku_code);
      return !recorded || recorded.quantity_blr !== line.quantity_blr ||
        recorded.quantity_chn !== line.quantity_chn || recorded.total_quantity !== line.total_quantity ||
        Math.abs(recorded.estimated_spend - line.estimated_spend) > 0.01;
    })) throw new Error('The existing RFQ lines differ from the source PRs. Review the RFQ before downloading it.');
  }

  const categories = [...new Set(lines.map((line) => line.category))].map((category) => ({
    category,
    skus: lines.filter((line) => line.category === category).length,
    quantity: lines.filter((line) => line.category === category).reduce((sum, line) => sum + line.total_quantity, 0),
  }));
  return { rfqId: DEMO_RFQ_ID, created, prs, lines, categories,
    totalQuantity: lines.reduce((sum, line) => sum + line.total_quantity, 0),
    baseline: prs.reduce((sum, pr) => sum + pr.baseline, 0) };
}
