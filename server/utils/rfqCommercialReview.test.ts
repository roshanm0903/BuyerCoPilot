import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { assessRfqCommercialValue } from './rfqCommercialReview';

const rfq = [
  { rfx_line_id: 'R1', total_quantity: 100, baseline_rate: 10 },
  { rfx_line_id: 'R2', total_quantity: 200, baseline_rate: 20 },
];

test('compares the full RFQ quantity at each quote price with the RFQ line-rate baseline', () => {
  const result = assessRfqCommercialValue(rfq, [
    { rfx_line_id: 'R1', quoted_quantity: 150, normalized_unit_price: 9 },
    { rfx_line_id: 'R2', quoted_quantity: 200, normalized_unit_price: 19 },
  ]);
  assert.deepEqual(result, {
    baselineValue: 5000,
    quotedValue: 4700,
    variancePercent: 6,
    requiredLines: 2,
  });
});

test('does not apply a full-RFQ price threshold to a partial or under-quantity quote', () => {
  assert.equal(assessRfqCommercialValue(rfq, [
    { rfx_line_id: 'R1', quoted_quantity: 100, normalized_unit_price: 9 },
  ]), null);
  assert.equal(assessRfqCommercialValue(rfq, [
    { rfx_line_id: 'R1', quoted_quantity: 100, normalized_unit_price: 9 },
    { rfx_line_id: 'R2', quoted_quantity: 150, normalized_unit_price: 19 },
  ]), null);
});
