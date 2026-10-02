import { runQuery } from '../db';

type Demand = {
  category: string;
  quantity: number;
  skus: number;
  required_by_date: string;
};

type SupplierCategory = {
  supplier_id: string;
  name: string;
  category: string;
  monthly_capacity_units: number | null;
  lead_time_days: number | null;
  otif_pct: number | null;
  covered_skus: number;
  product_capacity_units: number | null;
  product_lead_days: number | null;
};

const units = (value: number) => new Intl.NumberFormat('en-IN').format(value);
const cell = (value: string) => value.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');

/** Screens the approved PR scope against supplier category and SKU master data. */
export async function buildSupplierFitAnswer(now = new Date()) {
  const prs = await runQuery(`
    SELECT pr_id, pr_number FROM purchase_requests
    WHERE status = 'approved' ORDER BY pr_number;
  `);
  const demands = await runQuery(`
    SELECT i.category, SUM(prl.quantity) AS quantity,
           COUNT(DISTINCT i.item_id) AS skus,
           MIN(pr.required_by_date) AS required_by_date
    FROM purchase_requests pr
    JOIN purchase_request_lines prl ON prl.pr_id = pr.pr_id
    JOIN items i ON i.item_id = prl.item_id
    WHERE pr.status = 'approved'
    GROUP BY i.category ORDER BY i.category;
  `) as Demand[];

  if (!demands.length) {
    return { reply: 'There are no approved purchase request lines to match against suppliers.', suppliersScreened: 0, demandCategories: 0,
      recommendedSupplierIds: [] as string[], candidateSupplierIds: [] as string[], supplierResults: [] as Array<{ name: string; id: string; result: string; qualifyingScope: string; gaps: string; otif: string }> };
  }

  const supplierRows = await runQuery(`
    SELECT s.supplier_id, s.name, sc.category,
           sc.monthly_capacity_units, sc.lead_time_days, sp.otif_pct,
           COUNT(DISTINCT CASE WHEN p.active = 1 AND p.qualification_status = 'approved'
             AND i.sku_code LIKE p.sku_pattern THEN i.item_id END) AS covered_skus,
           MIN(CASE WHEN p.active = 1 AND p.qualification_status = 'approved'
             THEN p.monthly_capacity_units END) AS product_capacity_units,
           MAX(CASE WHEN p.active = 1 AND p.qualification_status = 'approved'
             THEN p.lead_time_days END) AS product_lead_days
    FROM suppliers s
    JOIN supplier_categories sc ON sc.supplier_id = s.supplier_id
    LEFT JOIN supplier_performance sp ON sp.supplier_id = s.supplier_id
    LEFT JOIN supplier_products p ON p.supplier_id = s.supplier_id AND p.category = sc.category
    LEFT JOIN items i ON i.category = sc.category AND i.item_id IN (
      SELECT prl.item_id FROM purchase_request_lines prl
      JOIN purchase_requests pr ON pr.pr_id = prl.pr_id WHERE pr.status = 'approved'
    )
    WHERE s.status = 'active' AND sc.active = 1 AND sc.qualification_status = 'approved'
      AND sc.category IN (
        SELECT DISTINCT i2.category FROM purchase_request_lines prl2
        JOIN purchase_requests pr2 ON pr2.pr_id = prl2.pr_id
        JOIN items i2 ON i2.item_id = prl2.item_id WHERE pr2.status = 'approved'
      )
    GROUP BY s.supplier_id, sc.category
    ORDER BY s.name, sc.category;
  `) as SupplierCategory[];

  const bySupplier = new Map<string, { name: string; categories: Map<string, SupplierCategory> }>();
  for (const row of supplierRows) {
    if (!bySupplier.has(row.supplier_id)) bySupplier.set(row.supplier_id, { name: row.name, categories: new Map() });
    bySupplier.get(row.supplier_id)!.categories.set(row.category, row);
  }

  const demandByCategory = new Map(demands.map((d) => [d.category, d]));
  const daysAvailable = (deadline: string) => Math.ceil(
    (Date.parse(`${deadline}T00:00:00Z`) - now.getTime()) / 86_400_000
  );
  const evaluate = (row: SupplierCategory) => {
    const demand = demandByCategory.get(row.category)!;
    const capacity = row.monthly_capacity_units == null || row.product_capacity_units == null
      ? null : Math.min(row.monthly_capacity_units, row.product_capacity_units);
    const lead = row.lead_time_days == null || row.product_lead_days == null
      ? null : Math.max(row.lead_time_days, row.product_lead_days);
    const issues: string[] = [];
    if (row.covered_skus < demand.skus) issues.push(`SKU coverage ${row.covered_skus}/${demand.skus}`);
    if (capacity == null) issues.push('capacity unknown');
    else if (capacity < demand.quantity) issues.push(`recorded capacity ${units(capacity)} < demand ${units(demand.quantity)}`);
    if (lead == null) issues.push('lead time unknown');
    else if (lead > daysAvailable(demand.required_by_date)) issues.push(`lead time ${lead} days > ${daysAvailable(demand.required_by_date)} days available`);
    return { issues, capacity, lead };
  };

  const supplierResults: Array<{ name: string; id: string; result: string; qualifyingScope: string; gaps: string; otif: string }> = [];
  for (const [id, supplier] of bySupplier) {
    const passing = demands.filter((d) => {
      const row = supplier.categories.get(d.category);
      return row && evaluate(row).issues.length === 0;
    });
    const result = { name: supplier.name, id, result: '', qualifyingScope: '', gaps: '', otif: `${supplier.categories.values().next().value!.otif_pct}%` };
    if (passing.length === demands.length) {
      result.result = 'Full scope';
      result.qualifyingScope = demands.map((d) => {
        const row = supplier.categories.get(d.category)!;
        const check = evaluate(row);
        return `${d.category}: ${units(check.capacity!)} units/month, ${check.lead} days lead`;
      }).join('; ');
    } else if (passing.length) {
      result.result = 'Category only';
      result.qualifyingScope = passing.map((d) => d.category).join(', ');
      result.gaps = demands.filter((d) => !passing.includes(d)).map((d) => {
        const row = supplier.categories.get(d.category);
        return `${d.category}: ${row ? evaluate(row).issues.join(', ') : 'no approved category mapping'}`;
      }).join('; ');
    } else {
      result.result = 'Needs review';
      const reasons = [...supplier.categories.values()].flatMap((row) => evaluate(row).issues);
      result.gaps = [...new Set(reasons)].join('; ');
    }
    supplierResults.push(result);
  }
  const resultOrder: Record<string, number> = { 'Full scope': 0, 'Category only': 1, 'Needs review': 2 };
  supplierResults.sort((a, b) => resultOrder[a.result] - resultOrder[b.result] || a.name.localeCompare(b.name));

  const scope = prs.map((pr: { pr_number: string }) => `\`${pr.pr_number}\``).join(' and ');
  const demandLines = demands.length > 1
    ? `| Category | Quantity | SKUs | Required by |\n|---|---:|---:|---|\n${demands.map((d) => `| ${cell(d.category)} | ${units(d.quantity)} units | ${d.skus} | ${d.required_by_date} |`).join('\n')}`
    : `${demands[0].category}: **${units(demands[0].quantity)} units**, ${demands[0].skus} SKUs, needed by ${demands[0].required_by_date}.`;
  const supplierLines = supplierResults.length > 1
    ? `| Supplier | Screening result | Qualifying scope | Gaps / checks | OTIF |\n|---|---|---|---|---:|\n${supplierResults.map((s) => `| **${cell(s.name)}** (\`${s.id}\`) | ${s.result} | ${cell(s.qualifyingScope || '—')} | ${cell(s.gaps || '—')} | ${s.otif} |`).join('\n')}`
    : supplierResults.length === 1
      ? `**${supplierResults[0].name}** (\`${supplierResults[0].id}\`): ${supplierResults[0].result}. ${supplierResults[0].qualifyingScope} ${supplierResults[0].gaps}`
      : 'No active, approved suppliers have a mapping to these categories.';
  const recommendedSupplierIds = supplierResults
    .filter((supplier) => supplier.result === 'Full scope' || supplier.result === 'Category only')
    .map((supplier) => supplier.id);
  const reply = `### Suppliers for the consolidated PR demand

I screened ${scope} against the supplier category and SKU mappings, recorded monthly capacity, lead time, and historical OTIF.

${demandLines}

${supplierLines}

These are **screening results**, not a delivery commitment. Monthly capacity is recorded capacity, not confirmed free capacity for this order. Confirm available capacity, exact SKU specifications, and the delivery date with each shortlisted supplier before awarding. Where category and product capacity differ, I used the lower figure.`;

  return { reply, suppliersScreened: bySupplier.size, demandCategories: demands.length,
    recommendedSupplierIds, candidateSupplierIds: supplierResults.map((supplier) => supplier.id), supplierResults };
}
