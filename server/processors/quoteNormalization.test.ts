import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { normalizePriceAndUom } from './quoteNormalization';

test('a price per kg waits for supplier-confirmed piece weight', () => {
  const result = normalizePriceAndUom(118, 'per kg', 'BTL-001');
  assert.equal(result.normalizedPrice, null);
  assert.equal(result.assessment?.status, 'needs_confirmation');
  assert.match(result.assessment?.reason || '', /weight of one piece/);
});

test('a stated count-based price needs no clarification', () => {
  const result = normalizePriceAndUom(1650, 'per 100 pcs', 'CTN-001');
  assert.equal(result.normalizedPrice, 16.5);
  assert.equal(result.assessment, null);
});
