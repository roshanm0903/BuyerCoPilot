export type PlantLocation = 'BLR' | 'CHN';

export interface ProductItem {
  id: string;
  skuCode: string;
  category: 'PET Bottles' | 'Cartons';
  name: string;
  sizeSpecification: string;
  neckOrFlute?: string;
  weightGramsOrGsm?: string;
  quantityBLR: number;
  quantityCHN: number;
  totalQuantity: number;
  uom: string;
  baselineRate: number; // in INR
}

export interface PurchaseRequisition {
  id: string;
  prNumber: string;
  factoryName: string;
  factoryCity: string;
  plantCode: PlantLocation;
  address: string;
  requestor: string;
  dateCreated: string;
  deliveryCommittedBy: string;
  costCenter: string;
  bottleLinesCount: number;
  cartonLinesCount: number;
  totalQuantity: number;
  estimatedBudget: number;
}

export interface SupplierRecord {
  id: string;
  code: string;
  alias: string;
  name: string;
  capabilities: string;
  receivedDeliveries: number;
  onTimeDeliveries: number;
  rejectedReceipts: number;
  otifPercent: number;
  historyInterpretation: string;
  paymentTerms: string;
  creditDays: number;
  freightTerms: string;
  freightCostBLR: number;
  freightCostCHN: number;
  discountPolicy: string;
  foodContactStatus: 'PASS' | 'FAIL' | 'MISSING';
  cartonCompressionStatus: 'PASS' | 'FAIL';
  festivePrintApproved: boolean; // CTN-009, CTN-010
  status: 'QUALIFIED' | 'CONDITIONAL' | 'DISQUALIFIED';
  statusReason: string;
  recentMessage?: {
    date: string;
    subject: string;
    snippet: string;
  };
}

export interface SourcingAllocation {
  scenarioId: 'dual_70_30' | 'lowest_cost' | 'single_f';
  name: string;
  tagline: string;
  isRecommended?: boolean;
  primarySupplier: string;
  primarySharePercent: number;
  secondarySupplier?: string;
  secondarySharePercent?: number;
  totalSpend: number;
  baselineSpend: number;
  savings: number;
  savingsPercent: number;
  resilienceScore: number;
  notes: string[];
}
