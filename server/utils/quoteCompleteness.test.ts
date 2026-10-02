import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { evaluateQuoteCompleteness } from './quoteCompleteness';

test('a three-line quote cannot be complete against a 30-line RFQ', () => {
  const result = evaluateQuoteCompleteness({
    quotedLines: 3, requiredLines: 30, outOfScopeLines: 1,
    missingFields: [], confirmationFields: [], supplierStatus: 'active',
  });
  assert.equal(result.status, 'partial');
  assert.deepEqual(result.issues, [
    'Only 3 of 30 RFQ items quoted',
    '1 quoted item outside approved supplier categories',
  ]);
});

test('full coverage still needs review when terms are unconfirmed', () => {
  assert.equal(evaluateQuoteCompleteness({
    quotedLines: 30, requiredLines: 30, outOfScopeLines: 0,
    missingFields: [], confirmationFields: ['Freight'], supplierStatus: 'active',
  }).status, 'needs_review');
});

test('full line coverage is incomplete when commercial fields are missing', () => {
  const result = evaluateQuoteCompleteness({
    quotedLines: 30, requiredLines: 30, outOfScopeLines: 0,
    missingFields: [], confirmationFields: [], supplierStatus: 'active',
    requiredFieldsMissing: ['payment terms'],
  });
  assert.equal(result.status, 'incomplete');
  assert.match(result.issues.join(' '), /payment terms/);
});
