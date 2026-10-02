export interface QuoteCoverage {
  quotedLines: number;
  requiredLines: number;
  outOfScopeLines: number;
  missingFields: string[];
  confirmationFields: string[];
  supplierStatus: string;
  requiredFieldsMissing?: string[];
}

export function evaluateQuoteCompleteness(coverage: QuoteCoverage) {
  const issues: string[] = [];
  if (coverage.requiredLines === 0) issues.push('RFQ item scope is missing');
  if (coverage.quotedLines < coverage.requiredLines) {
    issues.push(`Only ${coverage.quotedLines} of ${coverage.requiredLines} RFQ items quoted`);
  }
  if (coverage.outOfScopeLines > 0) {
    issues.push(`${coverage.outOfScopeLines} quoted item${coverage.outOfScopeLines === 1 ? '' : 's'} outside approved supplier categories`);
  }
  if (coverage.missingFields.length) issues.push(`Missing: ${coverage.missingFields.join(', ')}`);
  if (coverage.confirmationFields.length) issues.push(`Confirm: ${coverage.confirmationFields.join(', ')}`);
  if (coverage.requiredFieldsMissing?.length) issues.push(`Quote details missing or inconsistent: ${coverage.requiredFieldsMissing.join(', ')}`);
  if (coverage.supplierStatus === 'disqualified') issues.push('Supplier is disqualified');

  const status = coverage.requiredLines === 0 || coverage.supplierStatus === 'disqualified' || coverage.missingFields.length || coverage.requiredFieldsMissing?.length
    ? 'incomplete'
    : coverage.quotedLines < coverage.requiredLines
      ? 'partial'
      : coverage.outOfScopeLines || coverage.confirmationFields.length
        ? 'needs_review'
        : 'complete';
  return { status, issues };
}
