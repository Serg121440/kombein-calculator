export type Platform = "OZON" | "WB";

export type PricingPlan = "FREE" | "PRO" | "ENTERPRISE";

export interface Store {
  id: string;
  platform: Platform;
  name: string;
  apiKeyMasked: string;
  /** Base64-obfuscated key; only used server-side via API proxy routes */
  apiKeyEncoded?: string;
  clientId?: string;
  active: boolean;
  lastSyncAt?: string;
  /** WB-only: last cursor for incremental card sync { updatedAt, nmID } */
  wbCardsCursor?: { updatedAt: string; nmID: number };
  createdAt: string;
}

export interface Product {
  id: string;
  storeId: string;
  sku: string;
  name: string;
  category: string;
  purchasePrice: number;
  sellingPrice: number;
  weightKg: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  active: boolean;
  createdAt: string;
}

export type TariffType =
  | "COMMISSION"
  | "LOGISTICS"
  | "STORAGE"
  | "LAST_MILE"
  | "ACQUIRING";

export type TariffSource = "MANUAL" | "FILE" | "API";

export interface Tariff {
  id: string;
  storeId: string;
  platform: Platform;
  type: TariffType;
  category: string;
  /** Percent for COMMISSION/ACQUIRING, RUB for LOGISTICS/LAST_MILE, RUB/L/day for STORAGE */
  value: number;
  /** Optional formula: "weight" → value×kg, "volume" → value×L, omit → flat fee */
  formula?: string;
  /** LOGISTICS tier: lower bound in rangeUnit (inclusive) */
  rangeMin?: number;
  /** LOGISTICS tier: upper bound in rangeUnit (exclusive). Omit = no upper limit */
  rangeMax?: number;
  /** Unit for range bounds. Default "L" (litres of volume) */
  rangeUnit?: "kg" | "L";
  effectiveFrom: string;
  effectiveTo?: string;
  source: TariffSource;
  createdAt: string;
}

export type DataSource = "api" | "upload" | "manual";

export type TransactionType =
  | "SALE"
  | "COMMISSION"
  | "LOGISTICS"
  | "STORAGE"
  | "PENALTY"
  | "REFUND"
  | "ADVERTISING"
  | "SUBSIDY"
  | "OTHER";

export type EconomicsModel = "MODEL1" | "MODEL2" | "MODEL3";

export interface Transaction {
  id: string;
  storeId: string;
  productId?: string;
  sku?: string;
  orderId: string;
  date: string;
  type: TransactionType;
  amount: number;
  description?: string;
  reportId?: string;
  rawData?: Record<string, unknown>;
  /** Data origin — drives conflict resolution priority */
  source?: DataSource;
  /** Marketplace-assigned ID: Ozon operation_id, WB srid/rrd_id */
  externalId?: string;
  /** Dedup fingerprint — "ext|..." or "cnt|..." */
  fingerprint?: string;
}

export interface ImportReport {
  id: string;
  storeId: string;
  fileName: string;
  importedAt: string;
  rowsTotal: number;
  rowsImported: number;
  rowsUpdated: number;
  rowsSkipped: number;
  rowsErrors: number;
  errors: string[];
}

export interface UnitEconomicsPlan {
  productId: string;
  revenue: number;
  commission: number;
  logistics: number;
  storage: number;
  acquiring: number;
  lastMile: number;
  costOfGoods: number;
  grossProfit: number;
  marginPct: number;
  roiPct: number;
}

export interface UnitEconomicsFact {
  productId: string;
  // Raw period totals
  revenue: number;
  commission: number;
  logistics: number;
  storage: number;
  advertising: number;
  penalties: number;
  refunds: number;
  others: number;
  acquiring: number;
  costOfGoods: number;
  grossProfit: number;
  marginPct: number;
  roiPct: number;
  // Units
  unitsSold: number;
  /** SALE count − REFUND count, floored at 0 */
  unitsRedeemed: number;
}

/** Per-unit breakdown produced by Model 2 or Model 3 */
export interface UnitEconomicsPerUnit {
  model: "MODEL2" | "MODEL3";
  /** Number of effective units costs were distributed over */
  unitsBase: number;
  /** Actual (M2) or input (M3) redemption rate */
  redemptionRate: number;
  revenue: number;
  commission: number;
  logistics: number;
  storage: number;
  advertising: number;
  acquiring: number;
  penalties: number;
  costOfGoods: number;
  grossProfit: number;
  marginPct: number;
  roiPct: number;
}

export interface AppSettings {
  storageDays: number;
  defaultCurrency: "RUB";
  plan: PricingPlan;
}
