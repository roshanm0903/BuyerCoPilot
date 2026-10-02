import * as XLSX from 'xlsx';

export interface RfqWorkbookLine {
  sku_code: string;
  item_name: string;
  category: string;
  size_specification: string;
  weight_or_gsm: string | null;
  quantity_blr: number;
  quantity_chn: number;
  total_quantity: number;
  uom: string;
  baseline_rate: number;
}

export function generateRfqWorkbookBuffer(items: RfqWorkbookLine[]): Buffer {
  const wb = XLSX.utils.book_new();
  const totalQuantity = items.reduce((sum, item) => sum + Number(item.total_quantity), 0);
  const blrQuantity = items.reduce((sum, item) => sum + Number(item.quantity_blr), 0);
  const chnQuantity = items.reduce((sum, item) => sum + Number(item.quantity_chn), 0);
  const baselineSpend = items.reduce((sum, item) => sum + Number(item.total_quantity) * Number(item.baseline_rate), 0);

  // -------------------------------------------------------------
  // SHEET 1: RFQ Scope & Event Overview
  // -------------------------------------------------------------
  const scopeData = [
    ['REQUEST FOR QUOTATION (RFQ) - EVENT SPECIFICATION PACKET'],
    ['Event Reference:', 'RFQ-2026-041'],
    ['Event Title:', 'Annual Packaging Procurement: PET Bottles & Corrugated Cartons'],
    ['Issuing Entity:', 'A2B Foods Enterprise Strategic Procurement Division'],
    ['Procurement Workspace:', 'Consolidated Requisitions (Bangalore & Chennai)'],
    [''],
    ['DELIVERY LOCATIONS & REQUISITIONS'],
    ['Delivery Location 1:', 'Bengaluru (Whitefield)', 'Requisition:', 'PR-BLR-1088'],
    ['Delivery Location 2:', 'Chennai (Sriperumbudur)', 'Requisition:', 'PR-CHN-1045'],
    [''],
    ['KEY EVENT DATES & TIMELINES'],
    ['RFQ Release Date:', '2026-09-15 09:00 IST'],
    ['Clarification Window Closes:', '2026-09-25 17:00 IST'],
    ['Final Bid Submission Deadline:', '2026-09-30 17:00 IST (Strict Cutoff)'],
    ['Delivery Location Dock Target:', '2026-10-25 08:00 IST (Production Go-Live)'],
    ['Contract Duration:', '12 Months Annual Contract (Firm Price Agreement)'],
    [''],
    ['COMMERCIAL BASELINE & AGGREGATED METRICS'],
    ['Total Distinct Line Items (SKUs):', items.length],
    ['Total Consolidated Demand Volume:', `${totalQuantity.toLocaleString('en-IN')} Units (EA)`],
    ['Bengaluru Delivery Volume:', `${blrQuantity.toLocaleString('en-IN')} Units (EA)`],
    ['Chennai Delivery Volume:', `${chnQuantity.toLocaleString('en-IN')} Units (EA)`],
    ['Aggregated Baseline Spend:', `₹${baselineSpend.toLocaleString('en-IN')} INR`],
    ['Target Sourcing Strategy:', 'Strategic Dual-Sourcing (70% Primary / 30% Secondary Split)'],
    ['Bidding Currency:', 'Indian Rupee (INR)'],
    [''],
    ['INSTRUCTIONS TO BIDDERS'],
    ['1.', 'Complete the unit rate quoting columns in Sheet 2: Line_Items_Schedule.'],
    ['2.', 'Answer all 10 mandatory questions in Sheet 3: Vendor_Questionnaire.'],
    ['3.', 'Sign and endorse the commercial governance standards in Sheet 4: RFQ_Terms_Conditions.'],
    ['4.', 'Submit your completed workbook packet to rfq-desk@procure-sourcing.a2b.com before deadline.'],
  ];

  const wsScope = XLSX.utils.aoa_to_sheet(scopeData);
  wsScope['!cols'] = [{ wch: 36 }, { wch: 45 }, { wch: 18 }, { wch: 25 }];
  XLSX.utils.book_append_sheet(wb, wsScope, 'RFQ_Scope_Overview');

  // -------------------------------------------------------------
  // SHEET 2: Consolidated Line Items Schedule (with Vendor Bidding Columns)
  // -------------------------------------------------------------
  const lineItemHeaders = [
    'Line #',
    'SKU Code',
    'Item Description',
    'Category',
    'Size Specification & Neck / Ply',
    'Weight / GSM',
    'Bengaluru Demand (EA)',
    'Chennai Demand (EA)',
    'Total Consolidated Qty (EA)',
    'UOM',
    'Vendor Quoted Unit Price (INR)',
    'Vendor Make / Brand',
    'Committed Lead Time (Days)',
    'Quoted Freight to BLR (INR/lot)',
    'Quoted Freight to CHN (INR/lot)',
    'Vendor Comments',
  ];

  const lineItemRows = items.map((item, index) => [
    index + 1,
    item.sku_code,
    item.item_name,
    item.category,
    item.size_specification,
    item.weight_or_gsm,
    item.quantity_blr,
    item.quantity_chn,
    item.total_quantity,
    item.uom,
    '', // Vendor to fill: Quoted Unit Price
    '', // Vendor to fill: Make/Brand
    '', // Vendor to fill: Lead time
    '', // Vendor to fill: Freight BLR
    '', // Vendor to fill: Freight CHN
    '', // Vendor to fill: Comments
  ]);

  const wsLines = XLSX.utils.aoa_to_sheet([lineItemHeaders, ...lineItemRows]);
  wsLines['!cols'] = [
    { wch: 8 },  // Line
    { wch: 12 }, // SKU
    { wch: 32 }, // Item Name
    { wch: 14 }, // Category
    { wch: 28 }, // Size spec
    { wch: 15 }, // Weight
    { wch: 18 }, // BLR Qty
    { wch: 18 }, // CHN Qty
    { wch: 22 }, // Total Qty
    { wch: 6 },  // UOM
    { wch: 22 }, // Quoted Price
    { wch: 18 }, // Make
    { wch: 20 }, // Lead time
    { wch: 22 }, // Freight BLR
    { wch: 22 }, // Freight CHN
    { wch: 25 }, // Comments
  ];
  XLSX.utils.book_append_sheet(wb, wsLines, 'Line_Items_Schedule');

  // -------------------------------------------------------------
  // SHEET 3: Mandatory Commercial & Technical Questionnaire
  // -------------------------------------------------------------
  const questionnaireData = [
    ['#', 'Category', 'Questionnaire Item / Technical Inquiry', 'Requirement Type', 'A2B Compliance Standard', 'Vendor Response / Commitment', 'Supporting Document Attached?'],
    [
      1,
      'Food Contact & Safety',
      'Can you provide NABL-accredited laboratory migration test certificates for PET preforms conforming to IS 12252 / US-FDA 21 CFR 177.1520?',
      'MANDATORY GATING',
      'Zero migration non-conformance. Batch certificates required with every delivery lot.',
      '',
      '',
    ],
    [
      2,
      'Manufacturing Capacity',
      'What is your plant monthly installed and available free capacity for PET bottles and 5-ply cartons?',
      'MANDATORY GATING',
      'Minimum monthly capacity must exceed 500,000 bottles and 150,000 cartons.',
      '',
      '',
    ],
    [
      3,
      'Manufacturing Facility Location',
      'State the precise manufacturing facility address, distance in kilometers to Bengaluru (Whitefield) and Chennai (Sriperumbudur).',
      'LOGISTICS AUDIT',
      'Proximity under 150 km preferred for rapid JIT dock delivery replenishment.',
      '',
      '',
    ],
    [
      4,
      'Payment & Credit Terms',
      'Confirm standard credit payment terms offered (e.g. Net 30, Net 45, Net 60 days from invoice acceptance).',
      'COMMERCIAL GATING',
      'Net 45 or Net 60 days required. Advance payments (e.g. 30% advance) will trigger disqualification.',
      '',
      '',
    ],
    [
      5,
      'Tooling & Mould Fee Policy',
      'Do you require custom tooling/mould charges for the specialized 500ml heavy-duty bottle preforms?',
      'COMMERCIAL SAVINGS',
      'Preference for 100% tooling fee waiver upon allocation of >= 30% volume.',
      '',
      '',
    ],
    [
      6,
      'Freight & Transportation Structure',
      'Are your prices quoted on DDP delivered basis, or will freight be charged separately per truckload?',
      'LOGISTICS EVALUATION',
      'All-inclusive DDP delivered rates preferred. If separate, rate must be capped per trip.',
      '',
      '',
    ],
    [
      7,
      'Quality & SLA Commitment',
      'Do you agree to a 24-hour Root Cause Analysis (8D Report) and replacement SLA for any rejected dock lot?',
      'SLA GOVERNANCE',
      'Replacement lot must be dispatched within 48 hours of dock non-conformance notice.',
      '',
      '',
    ],
    [
      8,
      'Firm Price Validity',
      'Confirm that quoted unit prices will remain firm, locked, and immune to indexation for 12 calendar months.',
      'CONTRACT LOCK',
      '12 months price validity without resin escalation clauses.',
      '',
      '',
    ],
    [
      9,
      'Business Continuity & Redundancy',
      'In the event of plant shutdown or force majeure, what is your secondary fallback production facility?',
      'SUPPLY CONTINUITY',
      'Audited secondary production unit must be declared with equal tooling capability.',
      '',
      '',
    ],
    [
      10,
      'Key Account Management',
      'Provide contact details (Name, Title, Direct Mobile, Escalation Email) of the dedicated Key Account Director.',
      'RELATIONSHIP MGT',
      'Dedicated point of contact available 24/7 for delivery coordination.',
      '',
      '',
    ],
  ];

  const wsQuestionnaire = XLSX.utils.aoa_to_sheet(questionnaireData);
  wsQuestionnaire['!cols'] = [
    { wch: 6 },
    { wch: 22 },
    { wch: 45 },
    { wch: 20 },
    { wch: 35 },
    { wch: 35 },
    { wch: 25 },
  ];
  XLSX.utils.book_append_sheet(wb, wsQuestionnaire, 'Vendor_Questionnaire');

  // -------------------------------------------------------------
  // SHEET 4: RFQ Terms and Conditions
  // -------------------------------------------------------------
  const termsData = [
    ['A2B FOODS STRATEGIC PROCUREMENT - RFQ TERMS & CONDITIONS'],
    ['Event Reference:', 'RFQ-2026-041'],
    ['Applicable To:', 'All Invited Bidders for Packaging Procurement Event'],
    [''],
    ['SECTION 1: QUALITY & FOOD SAFETY COMPLIANCE'],
    ['1.1', 'All PET bottles and preforms must strictly comply with FSSAI regulations and US-FDA 21 CFR 177.1520 food-grade standards.'],
    ['1.2', 'Duplex cartons and master shipper boxes must maintain a minimum Bursting Factor (BF) of 22 and ECT rating specified in Schedule 2.'],
    ['1.3', 'Any lot exhibiting heavy metal migration, off-odors, or structural deformation will be rejected at the supplier’s sole cost.'],
    [''],
    ['SECTION 2: DELIVERY SLA & ON-TIME IN-FULL (OTIF) OBLIGATIONS'],
    ['2.1', 'The supplier agrees to maintain an On-Time In-Full (OTIF) delivery compliance threshold of not less than 95.0%.'],
    ['2.2', 'Delivery dock appointments must be strictly adhered to. Late deliveries will incur a liquidated damage penalty of 1.0% per week of delay.'],
    ['2.3', 'A2B reserves the right to procure balance quantities from secondary allocated vendors if delivery delays exceed 72 hours.'],
    [''],
    ['SECTION 3: PALLETIZATION & PACKAGING STANDARDS'],
    ['3.1', 'All shipments must be delivered on standard 1200 x 1000 mm ISPM-15 heat-treated wooden or heavy plastic pallets.'],
    ['3.2', 'Cartons must be palletized with edge protectors and shrink-wrapped with UV-resistant stretch film (minimum 25 micron thickness).'],
    [''],
    ['SECTION 4: COMMERCIAL TERMS & INVOICE SETTLEMENT'],
    ['4.1', 'Payment terms shall be strictly Net 45 or Net 60 days following physical material acceptance and GST invoice submission.'],
    ['4.2', 'Invoices must clearly cite the Purchase Order (PO) number, delivery location, and corresponding Certificate of Analysis (COA).'],
    ['4.3', 'No advance payments or security deposits shall be made by A2B under this sourcing contract.'],
    [''],
    ['SECTION 5: CONFIDENTIALITY & INTEGRITY UNDERTAKING'],
    ['5.1', 'All drawings, CAD designs, volume forecasts, and commercial terms provided in this RFQ remain proprietary to A2B Foods.'],
    ['5.2', 'Suppliers shall not disclose, replicate, or utilize proprietary preform designs for any third-party commercial purposes.'],
    [''],
    ['BIDDER ACKNOWLEDGMENT & ENDORSEMENT'],
    ['Authorized Signatory Name:', '______________________________________'],
    ['Designation & Company Seal:', '______________________________________'],
    ['Date of Endorsement:', '______________________________________'],
  ];

  const wsTerms = XLSX.utils.aoa_to_sheet(termsData);
  wsTerms['!cols'] = [{ wch: 10 }, { wch: 75 }];
  XLSX.utils.book_append_sheet(wb, wsTerms, 'RFQ_Terms_Conditions');

  const excelBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  return excelBuffer;
}
