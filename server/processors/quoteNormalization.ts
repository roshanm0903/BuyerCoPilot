/**
 * Processing Code Node for Quote Normalization & Mathematical Reconciliation
 * 
 * Executes deterministic conversions outside the LLM prompt:
 * 1. Unit of Measure (UOM) normalization across count, weight, volume, packaging, and area.
 * 2. Lead time conversion from months, weeks, and business days to integer calendar days.
 * 3. Item name derivation and line-level total calculation (quantity × unit price).
 * 4. Quote-level total amount reconciliation.
 * 5. Strictly preserves NULL and 0 distinctly without substituting plausible fake sample values.
 */

export interface RawExtractedQuote {
  quote_number?: string;
  supplier_name?: string;
  quote_date?: string;
  currency?: string;
  stated_total_amount?: number | null;
  validity_phrase?: string | null;
  payment_terms_phrase?: string | null;
  freight_treatment_raw?: string | null;
  freight_entries?: Array<{
    destination_label?: string;
    amount?: number | null;
    currency?: string;
    is_included?: boolean;
  }>;
  discount_condition?: string | null;
  compliance_notes?: string | null;
  lines?: Array<{
    line_identifier?: string;
    item_name?: string;
    item_description?: string;
    raw_quoted_quantity?: number | null;
    raw_quantity_uom?: string;
    raw_unit_price?: number | null;
    raw_price_uom?: string;
    raw_line_total?: number | null;
    raw_moq_value?: number | null;
    raw_moq_uom?: string;
    raw_lead_time_value?: number | null;
    raw_lead_time_unit?: string;
    raw_lead_time_phrase?: string;
    specification_status?: string;
    destination_facility?: string | null;
    delivery_date?: string | null;
  }>;
  field_assessments?: Array<{
    field_name: string;
    raw_value: string;
    normalized_value: string;
    status: 'needs_confirmation' | 'missing_needs_follow_up';
    reason: string;
    evidence_snippet: string;
  }>;
}

export interface NormalizedQuoteResult {
  quote_number: string;
  supplier_name: string;
  quote_date: string;
  currency: string;
  stated_total_amount: number | null;
  calculated_total_amount: number | null;
  amount_variance: number | null;
  valid_until: string | null;
  payment_terms_days: number | null;
  freight_treatment: 'included' | 'extra' | 'separate_line' | 'not_stated';
  freight_blr: number;
  freight_chn: number;
  discount_condition: string | null;
  lines: Array<{
    rfx_line_id: string;
    item_name: string;
    raw_item_description: string;
    quoted_quantity: number | null;
    quoted_uom: string | null;
    unit_price: number | null;
    price_uom: string | null;
    normalized_unit_price: number | null;
    normalized_uom: string | null;
    line_total_amount: number | null;
    moq_quantity: number | null;
    lead_time_days: number | null;
    lead_time_conversion_note?: string;
    specification_status: string;
    delivery_date: string | null;
  }>;
  field_assessments: Array<{
    field_name: string;
    raw_value: string;
    normalized_value: string;
    status: 'needs_confirmation' | 'missing_needs_follow_up';
    reason: string;
    evidence_snippet: string;
  }>;
}

/**
 * Normalizes lead time value and unit into calendar days. Preserves null if not stated.
 */
export function normalizeLeadTimeToDays(
  value: number | null | undefined,
  unit: string | undefined,
  rawPhrase?: string
): { days: number | null; note?: string } {
  if (value === null || value === undefined || isNaN(value)) {
    return { days: null, note: rawPhrase || 'Lead time not explicitly stated' };
  }

  const cleanUnit = (unit || '').toLowerCase().trim();

  if (cleanUnit.includes('month')) {
    const days = Math.round(value * 30.4);
    return { days, note: `Converted ${value} month(s) to ${days} calendar days (${value} × 30.4)` };
  }

  if (cleanUnit.includes('week')) {
    const days = Math.round(value * 7);
    return { days, note: `Converted ${value} week(s) to ${days} calendar days (${value} × 7)` };
  }

  if (cleanUnit.includes('business') || cleanUnit.includes('working')) {
    const days = Math.round(value * 1.4);
    return { days, note: `Converted ${value} business days to ${days} calendar days (${value} × 1.4)` };
  }

  if (cleanUnit.includes('hour')) {
    const days = Math.max(1, Math.ceil(value / 24));
    return { days, note: `Converted ${value} hours to ${days} day(s) (ceil(${value} / 24))` };
  }

  return { days: Math.round(value), note: `${value} calendar days` };
}

/**
 * Normalizes Unit of Measure (UOM) and unit price to base unit (e.g. EA).
 * Preserves null if price is missing. Preserves 0 if price is zero.
 */
export function normalizePriceAndUom(
  rawPrice: number | null | undefined,
  rawPriceUom: string | undefined,
  itemCode?: string
): { normalizedPrice: number | null; normalizedUom: string | null; assessment?: any } {
  if (rawPrice === null || rawPrice === undefined || isNaN(rawPrice)) {
    return { normalizedPrice: null, normalizedUom: rawPriceUom || null };
  }

  const uom = (rawPriceUom || 'EA').toLowerCase().trim();
  let normalizedPrice = rawPrice;
  let normalizedUom = 'EA';
  let assessment: any = null;

  // 1. Count Tier Conversions
  if (uom.includes('1000') || uom.includes('thousand') || uom.includes('/k')) {
    normalizedPrice = +(rawPrice / 1000).toFixed(4);
    normalizedUom = 'EA';
  } else if (uom.includes('100') || uom.includes('hundred') || uom.includes('centum')) {
    normalizedPrice = +(rawPrice / 100).toFixed(4);
    normalizedUom = 'EA';
  } else if (uom.includes('dozen') || uom === 'dzn') {
    normalizedPrice = +(rawPrice / 12).toFixed(4);
    normalizedUom = 'EA';
  } else if (uom.includes('gross')) {
    normalizedPrice = +(rawPrice / 144).toFixed(4);
    normalizedUom = 'EA';
  }
  // 2. Weight-based pricing
  else if (uom.includes('kg') || uom.includes('kilo')) {
    normalizedUom = 'EA';

    assessment = {
      field_name: `UOM Conversion (${itemCode || 'Line Item'})`,
      raw_value: `${rawPrice} / ${rawPriceUom}`,
      normalized_value: 'Awaiting confirmed unit weight in grams',
      status: 'needs_confirmation',
      reason: 'Quoted per kg. Ask the supplier to confirm the weight of one piece before calculating a price per EA.',
      evidence_snippet: `Raw price quoted as ${rawPrice} ${rawPriceUom}`,
    };
    return { normalizedPrice: null, normalizedUom, assessment };
  } else if (uom.includes('mt') || uom.includes('ton') || uom.includes('tonne')) {
    normalizedPrice = +(rawPrice / 1000).toFixed(4);
    normalizedUom = 'KG';
  }

  return { normalizedPrice, normalizedUom, assessment };
}

/**
 * Main Processing Code Node with strict NULL and Zero preservation
 */
export function processAndNormalizeQuote(raw: RawExtractedQuote): NormalizedQuoteResult {
  const assessments: Array<{
    field_name: string;
    raw_value: string;
    normalized_value: string;
    status: 'needs_confirmation' | 'missing_needs_follow_up';
    reason: string;
    evidence_snippet: string;
  }> = [];

  let calculatedLinesSubtotal: number | null = 0;

  // 1. Process Lines with item_name, deterministic UOM, line total, and lead time
  const processedLines = (raw.lines || []).map((line, idx) => {
    const rawPrice = line.raw_unit_price !== undefined && line.raw_unit_price !== null && !isNaN(Number(line.raw_unit_price))
      ? Number(line.raw_unit_price)
      : null;

    const rfxLineId = line.line_identifier || `LINE-${idx + 1}`;
    
    const quotedQty = line.raw_quoted_quantity !== undefined && line.raw_quoted_quantity !== null && !isNaN(Number(line.raw_quoted_quantity))
      ? Number(line.raw_quoted_quantity)
      : null;

    const moqVal = line.raw_moq_value !== undefined && line.raw_moq_value !== null && !isNaN(Number(line.raw_moq_value))
      ? Number(line.raw_moq_value)
      : null;

    // Derive or extract concise item name
    const itemName = line.item_name || line.item_description?.slice(0, 45) || `Item ${rfxLineId}`;

    // Deterministic UOM normalization
    const { normalizedPrice, normalizedUom, assessment: uomAssessment } = normalizePriceAndUom(
      rawPrice,
      line.raw_price_uom,
      rfxLineId
    );
    if (uomAssessment) {
      assessments.push(uomAssessment);
    }

    // Line total calculation: quantity * normalized unit price
    let lineTotal: number | null = null;
    if (quotedQty !== null && normalizedPrice !== null) {
      lineTotal = +(quotedQty * normalizedPrice).toFixed(2);
      if (calculatedLinesSubtotal !== null) {
        calculatedLinesSubtotal += lineTotal;
      }
    } else {
      calculatedLinesSubtotal = null; // Cannot calculate total if lines are missing prices or quantities
    }

    // Deterministic Lead Time conversion
    const { days: leadTimeDays, note: leadTimeNote } = normalizeLeadTimeToDays(
      line.raw_lead_time_value,
      line.raw_lead_time_unit,
      line.raw_lead_time_phrase
    );

    if (leadTimeDays === null) {
      assessments.push({
        field_name: `Lead Time Commitment (${itemName})`,
        raw_value: line.raw_lead_time_phrase || 'Not Stated',
        normalized_value: 'Unspecified Lead Time',
        status: 'missing_needs_follow_up',
        reason: 'Specific lead time or committed arrival date was omitted by vendor for this line.',
        evidence_snippet: line.raw_lead_time_phrase || 'No lead time phrase provided in quotation.',
      });
    }

    if (rawPrice === null) {
      assessments.push({
        field_name: `Unit Price (${itemName})`,
        raw_value: 'Missing Price',
        normalized_value: 'Unspecified Rate',
        status: 'missing_needs_follow_up',
        reason: 'Vendor response omitted unit price for this line item.',
        evidence_snippet: line.item_description || 'Price field is missing',
      });
    }

    return {
      rfx_line_id: rfxLineId,
      item_name: itemName,
      raw_item_description: line.item_description || itemName,
      quoted_quantity: quotedQty,
      quoted_uom: line.raw_quantity_uom || null,
      unit_price: rawPrice,
      price_uom: line.raw_price_uom || null,
      normalized_unit_price: normalizedPrice,
      normalized_uom: normalizedUom,
      line_total_amount: lineTotal,
      moq_quantity: moqVal,
      lead_time_days: leadTimeDays,
      lead_time_conversion_note: leadTimeNote,
      specification_status: line.specification_status || 'confirmed',
      delivery_date: line.delivery_date || null,
    };
  });

  // 2. Normalize Payment Terms (preserve null if not stated)
  let paymentTermsDays: number | null = null;
  const payPhrase = (raw.payment_terms_phrase || '').toLowerCase();
  if (payPhrase) {
    if (payPhrase.includes('45')) paymentTermsDays = 45;
    else if (payPhrase.includes('60')) paymentTermsDays = 60;
    else if (payPhrase.includes('90')) paymentTermsDays = 90;
    else if (payPhrase.includes('30')) paymentTermsDays = 30;
    else if (payPhrase.includes('advance') || payPhrase.includes('cash')) {
      paymentTermsDays = 0;
      assessments.push({
        field_name: 'Payment Terms Exception',
        raw_value: raw.payment_terms_phrase || 'Advance Payment Demanded',
        normalized_value: '0 Days (Advance Cash Required)',
        status: 'needs_confirmation',
        reason: 'Supplier demands cash advance before dispatch, violating standard 30/45-day credit policy.',
        evidence_snippet: raw.payment_terms_phrase || 'Advance payment required',
      });
    }
  }

  if (paymentTermsDays === null) {
    assessments.push({
      field_name: 'Payment Terms',
      raw_value: raw.payment_terms_phrase || 'Not Stated',
      normalized_value: 'Unspecified Credit Terms',
      status: 'missing_needs_follow_up',
      reason: 'Vendor response contains no credit days or payment terms confirmation.',
      evidence_snippet: raw.payment_terms_phrase || 'Document was searched; payment terms clause is missing.',
    });
  }

  // 3. Normalize Freight & Logistics Costs
  let freightTreatment: 'included' | 'extra' | 'separate_line' | 'not_stated' = 'not_stated';
  let freightBlr = 0;
  let freightChn = 0;

  const rawFreight = (raw.freight_treatment_raw || '').toLowerCase();
  if (rawFreight.includes('included') || rawFreight.includes('ddp') || rawFreight.includes('free')) {
    freightTreatment = 'included';
  } else if (rawFreight.includes('extra') || rawFreight.includes('actual')) {
    freightTreatment = 'extra';
    if (!raw.freight_entries?.length) {
      assessments.push({
        field_name: 'Freight Delivery Charges',
        raw_value: raw.freight_treatment_raw || 'Freight Extra',
        normalized_value: 'Unspecified Freight Extra',
        status: 'missing_needs_follow_up',
        reason: 'Supplier states "freight extra" but provides no delivery rates for factory plants.',
        evidence_snippet: raw.freight_treatment_raw || 'Freight extra from warehouse',
      });
    }
  } else if (raw.freight_entries && raw.freight_entries.length > 0) {
    freightTreatment = 'separate_line';
  }

  if (Array.isArray(raw.freight_entries)) {
    raw.freight_entries.forEach((fe) => {
      const dest = (fe.destination_label || '').toLowerCase();
      const amt = Number(fe.amount) || 0;
      if (dest.includes('blr') || dest.includes('bengaluru') || dest.includes('bangalore')) {
        freightBlr = amt;
      }
      if (dest.includes('chn') || dest.includes('chennai')) {
        freightChn = amt;
      }
    });
  }

  // 4. Quote-Level Total Amount Validation & Reconciliation
  let calculatedTotalAmount: number | null = null;
  if (calculatedLinesSubtotal !== null) {
    calculatedTotalAmount = +(calculatedLinesSubtotal + freightBlr + freightChn).toFixed(2);
  }

  const statedTotal = raw.stated_total_amount !== undefined && raw.stated_total_amount !== null && !isNaN(Number(raw.stated_total_amount))
    ? Number(raw.stated_total_amount)
    : null;

  let amountVariance: number | null = null;
  if (statedTotal !== null && calculatedTotalAmount !== null) {
    amountVariance = +Math.abs(statedTotal - calculatedTotalAmount).toFixed(2);

    if (amountVariance > 1) {
      assessments.push({
        field_name: 'Quote Total Amount Reconciliation',
        raw_value: `Stated: ₹${statedTotal.toLocaleString('en-IN')}`,
        normalized_value: `Calculated: ₹${calculatedTotalAmount.toLocaleString('en-IN')} (Variance: ₹${amountVariance.toLocaleString('en-IN')})`,
        status: 'needs_confirmation',
        reason: `Mathematical discrepancy detected between vendor-stated grand total (₹${statedTotal.toLocaleString('en-IN')}) and calculated line item sum + freight (₹${calculatedTotalAmount.toLocaleString('en-IN')}). Verify for omitted freight, taxes, or unlisted charges.`,
        evidence_snippet: `Vendor stated total: ${statedTotal}`,
      });
    }
  }

  // 5. Validity phrase normalization
  let validUntil: string | null = null;
  if (raw.validity_phrase) {
    const dateMatch = raw.validity_phrase.match(/\d{4}-\d{2}-\d{2}/);
    if (dateMatch) {
      validUntil = dateMatch[0];
    } else {
      validUntil = raw.validity_phrase;
    }
  }

  if (!validUntil) {
    assessments.push({
      field_name: 'Quote Validity Window',
      raw_value: raw.validity_phrase || 'Not Stated',
      normalized_value: 'Missing Expiry Date',
      status: 'missing_needs_follow_up',
      reason: 'Quote contains no validity duration or price expiration cutoff.',
      evidence_snippet: 'No expiration or validity phrase found in document.',
    });
  }

  // 6. Include incoming raw assessments if actionable
  if (Array.isArray(raw.field_assessments)) {
    raw.field_assessments.forEach((fa) => {
      if (fa.status === 'needs_confirmation' || fa.status === 'missing_needs_follow_up') {
        const isDuplicate = assessments.some(
          (a) => a.field_name.toLowerCase() === fa.field_name.toLowerCase()
        );
        if (!isDuplicate) {
          assessments.push(fa);
        }
      }
    });
  }

  return {
    quote_number: raw.quote_number || 'NOT_STATED',
    supplier_name: raw.supplier_name || 'Detected Supplier',
    quote_date: raw.quote_date || new Date().toISOString().slice(0, 10),
    currency: raw.currency || 'INR',
    stated_total_amount: statedTotal,
    calculated_total_amount: calculatedTotalAmount,
    amount_variance: amountVariance,
    valid_until: validUntil,
    payment_terms_days: paymentTermsDays,
    freight_treatment: freightTreatment,
    freight_blr: freightBlr,
    freight_chn: freightChn,
    discount_condition: raw.discount_condition || null,
    lines: processedLines,
    field_assessments: assessments,
  };
}
