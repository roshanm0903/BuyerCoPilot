export interface RfqReferenceLine {
  rfx_line_id: string;
  total_quantity: number;
  baseline_rate: number;
}

export interface SupplierQuoteLine {
  rfx_line_id: string;
  quoted_quantity: number | null;
  normalized_unit_price: number | null;
}

export interface RfqCommercialReview {
  baselineValue: number;
  quotedValue: number;
  variancePercent: number;
  requiredLines: number;
}

export const RFQ_COMMERCIAL_REVIEW_THRESHOLD_PERCENT = 20;

/** Compare the supplier's prices for the full RFQ demand against the RFQ line-rate baseline. */
export function assessRfqCommercialValue(
  rfqLines: RfqReferenceLine[],
  quoteLines: SupplierQuoteLine[],
): RfqCommercialReview | null {
  if (!rfqLines.length) return null;
  const quotedByLine = new Map(quoteLines.map((line) => [line.rfx_line_id, line]));
  const coversFullDemand = rfqLines.every((rfqLine) => {
    const quoteLine = quotedByLine.get(rfqLine.rfx_line_id);
    return quoteLine && Number(quoteLine.quoted_quantity) >= Number(rfqLine.total_quantity)
      && Number(quoteLine.normalized_unit_price) > 0;
  });
  if (!coversFullDemand) return null;

  const baselineValue = rfqLines.reduce((sum, line) =>
    sum + Number(line.total_quantity) * Number(line.baseline_rate), 0);
  const quotedValue = rfqLines.reduce((sum, line) =>
    sum + Number(line.total_quantity) * Number(quotedByLine.get(line.rfx_line_id)!.normalized_unit_price), 0);
  if (!Number.isFinite(baselineValue) || baselineValue <= 0 || !Number.isFinite(quotedValue)) return null;
  return {
    baselineValue: Math.round(baselineValue * 100) / 100,
    quotedValue: Math.round(quotedValue * 100) / 100,
    variancePercent: Math.abs(quotedValue - baselineValue) / baselineValue * 100,
    requiredLines: rfqLines.length,
  };
}
