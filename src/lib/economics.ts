import type {
  Product,
  Store,
  Tariff,
  TariffType,
  Transaction,
  UnitEconomicsFact,
  UnitEconomicsPlan,
  UnitEconomicsPerUnit,
} from "./types";

export interface EconomicsContext {
  storageDays: number;
  /** Fulfillment schema for Method 1 logistics/commission selection. Default: "FBS" */
  schema?: "FBO" | "FBS";
  /** Tax rate % on revenue (e.g. USN-6%). 0 or omitted = no tax. */
  taxRatePct?: number;
}

const DEFAULT_CONTEXT: EconomicsContext = { storageDays: 30, schema: "FBS", taxRatePct: 0 };

function isActiveOn(t: Tariff, dateIso: string): boolean {
  const d = new Date(dateIso).getTime();
  const from = new Date(t.effectiveFrom).getTime();
  const to = t.effectiveTo
    ? new Date(t.effectiveTo).getTime()
    : Number.POSITIVE_INFINITY;
  return d >= from && d <= to;
}

export function findTariff(
  tariffs: Tariff[],
  storeId: string,
  type: TariffType,
  category: string,
  dateIso: string,
): Tariff | undefined {
  const candidates = tariffs.filter(
    (t) =>
      t.storeId === storeId &&
      t.type === type &&
      isActiveOn(t, dateIso) &&
      (t.category === category || t.category === "*" || t.category === ""),
  );
  candidates.sort((a, b) => {
    const aExact = a.category === category ? 1 : 0;
    const bExact = b.category === category ? 1 : 0;
    if (aExact !== bExact) return bExact - aExact;
    return (
      new Date(b.effectiveFrom).getTime() - new Date(a.effectiveFrom).getTime()
    );
  });
  return candidates[0];
}

export function productVolumeLiters(p: Product): number {
  return (p.lengthCm * p.widthCm * p.heightCm) / 1000;
}

// ─── Logistics: range-aware tariff lookup ─────────────────────────────────────
// Ozon/WB logistics tariffs are weight- or volume-tiered, not category-based.
// When ranged tariffs exist for a store, match by product dimensions.
// Fall back to category-based match for flat/formula tariffs.

function findLogisticsTariff(
  tariffs: Tariff[],
  product: Product,
  date: string,
): Tariff | undefined {
  const weight = Math.max(0.1, product.weightKg);
  const volume = productVolumeLiters(product);

  const ranged = tariffs.filter(
    (t) =>
      t.storeId === product.storeId &&
      t.type === "LOGISTICS" &&
      isActiveOn(t, date) &&
      t.rangeMin !== undefined,
  );

  if (ranged.length > 0) {
    // Sort tiers by rangeMin so first match wins for overlapping tiers
    ranged.sort((a, b) => (a.rangeMin ?? 0) - (b.rangeMin ?? 0));
    const match = ranged.find((t) => {
      const val = t.rangeUnit === "kg" ? weight : volume;
      return val >= (t.rangeMin ?? 0) && val < (t.rangeMax ?? Infinity);
    });
    if (match) return match;
  }

  // Fall back to category/wildcard-based match
  return findTariff(tariffs, product.storeId, "LOGISTICS", product.category || "*", date);
}

function applyLogisticsTariff(t: Tariff, product: Product): number {
  const formula = t.formula?.toLowerCase() ?? "";
  if (formula.includes("weight")) return t.value * Math.max(0.1, product.weightKg);
  if (formula.includes("volume")) return t.value * productVolumeLiters(product);
  return t.value; // flat fee (tiered tariff already selected the right tier)
}

// ─── Ozon FBO delivery tariff table ──────────────────────────────────────────
// Source: "Тарифы по умолчанию" sheet from Ozon logistics Excel (May 2025).
// Two price brackets: ≤300 rub and >300 rub. Flat fee per volume tier.
// Applied when no manual LOGISTICS tariff is configured for the store.

const OZON_FBO_DELIVERY: Array<{ maxL: number; r0: number; r300: number }> = [
  { maxL: 0.200, r0: 17.28, r300: 56 },
  { maxL: 0.400, r0: 19.32, r300: 63 },
  { maxL: 0.600, r0: 21.35, r300: 67 },
  { maxL: 0.800, r0: 22.37, r300: 67 },
  { maxL: 1.000, r0: 23.38, r300: 67 },
  { maxL: 1.250, r0: 25.42, r300: 71 },
  { maxL: 1.500, r0: 26.43, r300: 74 },
  { maxL: 1.750, r0: 27.45, r300: 74 },
  { maxL: 2.000, r0: 29.48, r300: 74 },
  { maxL: 3.000, r0: 31.52, r300: 74 },
  { maxL: 4.000, r0: 35.58, r300: 78 },
  { maxL: 5.000, r0: 38.63, r300: 89 },
  { maxL: 6.000, r0: 42.70, r300: 89 },
  { maxL: 7.000, r0: 57.95, r300: 99 },
  { maxL: 8.000, r0: 62.02, r300: 99 },
  { maxL: 9.000, r0: 65.07, r300: 100 },
  { maxL: 10.000, r0: 69.13, r300: 100 },
  { maxL: 11.000, r0: 79.30, r300: 102 },
  { maxL: 12.000, r0: 83.37, r300: 102 },
  { maxL: 13.000, r0: 87.43, r300: 102 },
  { maxL: 14.000, r0: 92.52, r300: 106 },
  { maxL: 15.000, r0: 96.58, r300: 111 },
  { maxL: 17.000, r0: 96.58, r300: 119 },
  { maxL: 20.000, r0: 110.82, r300: 131 },
  { maxL: 25.000, r0: 118.95, r300: 143 },
  { maxL: 30.000, r0: 131.15, r300: 162 },
  { maxL: 35.000, r0: 146.40, r300: 177 },
  { maxL: 40.000, r0: 156.57, r300: 195 },
  { maxL: 45.000, r0: 175.88, r300: 209 },
  { maxL: 50.000, r0: 189.10, r300: 228 },
  { maxL: 60.000, r0: 207.40, r300: 244 },
  { maxL: 70.000, r0: 230.78, r300: 279 },
  { maxL: 80.000, r0: 249.08, r300: 299 },
  { maxL: 90.000, r0: 274.50, r300: 344 },
  { maxL: 100.000, r0: 284.67, r300: 371 },
  { maxL: 125.000, r0: 331.43, r300: 436 },
  { maxL: 150.000, r0: 381.25, r300: 503 },
  { maxL: 175.000, r0: 436.15, r300: 578 },
  { maxL: 200.000, r0: 483.93, r300: 692 },
  { maxL: 400.000, r0: 805.20, r300: 1026 },
  { maxL: 600.000, r0: 805.20, r300: 1457 },
  { maxL: 800.000, r0: 805.20, r300: 1891 },
  { maxL: Infinity, r0: 805.20, r300: 2232 },
];

function ozonFboDelivery(volumeLiters: number, priceRub: number): number {
  const tier = OZON_FBO_DELIVERY.find((t) => volumeLiters <= t.maxL) ?? OZON_FBO_DELIVERY.at(-1)!;
  return priceRub <= 300 ? tier.r0 : tier.r300;
}

// ─── Model 1: Planned unit economics ─────────────────────────────────────────

export function calculatePlan(
  product: Product,
  tariffs: Tariff[],
  ctx: EconomicsContext = DEFAULT_CONTEXT,
  date: string = new Date().toISOString(),
): UnitEconomicsPlan {
  const revenue = product.sellingPrice;
  const cat = product.category || "*";
  const schema = ctx.schema ?? "FBS";

  const commissionTariff = findTariff(tariffs, product.storeId, "COMMISSION", cat, date);
  const acquiringTariff = findTariff(tariffs, product.storeId, "ACQUIRING", cat, date);
  const logisticsTariff = findLogisticsTariff(tariffs, product, date);
  const storageTariff = findTariff(tariffs, product.storeId, "STORAGE", cat, date);
  const lastMileTariff = findTariff(tariffs, product.storeId, "LAST_MILE", cat, date);

  // Commission: schema-aware — prefer API-sourced rate, fall back to tariff
  const commissionPct =
    schema === "FBS"
      ? (product.fbsCommissionPct ?? product.commissionPct ?? commissionTariff?.value ?? 0)
      : (product.commissionPct ?? commissionTariff?.value ?? 0);
  const commission = revenue > 0 ? (revenue * commissionPct) / 100 : 0;
  const acquiring = acquiringTariff ? (revenue * acquiringTariff.value) / 100 : 0;

  // Logistics: manual tariff always wins; then schema-specific defaults
  let logistics: number;
  if (logisticsTariff) {
    logistics = applyLogisticsTariff(logisticsTariff, product);
  } else if (schema === "FBO" && product.commissionPct) {
    // FBO: embedded Ozon volume-based tariff table (Тарифы по умолчанию, May 2025)
    logistics = ozonFboDelivery(productVolumeLiters(product), revenue);
  } else if (schema === "FBS" && product.fbsDeliveryAmount) {
    // FBS: per-order delivery service fee from Ozon API
    logistics = product.fbsDeliveryAmount;
  } else {
    logistics = 0;
  }

  const liters = productVolumeLiters(product);
  const storage = storageTariff ? liters * storageTariff.value * ctx.storageDays : 0;
  const lastMile = lastMileTariff ? lastMileTariff.value : 0;
  const taxRatePct = ctx.taxRatePct ?? 0;
  const tax = taxRatePct > 0 ? (revenue * taxRatePct) / 100 : 0;
  const costOfGoods = product.purchasePrice;

  const grossProfit =
    revenue - commission - logistics - storage - acquiring - lastMile - tax - costOfGoods;
  const marginPct = revenue > 0 ? (grossProfit / revenue) * 100 : 0;
  const roiPct = costOfGoods > 0 ? (grossProfit / costOfGoods) * 100 : 0;

  return {
    productId: product.id,
    revenue,
    commission,
    logistics,
    storage,
    acquiring,
    lastMile,
    tax,
    costOfGoods,
    grossProfit,
    marginPct,
    roiPct,
  };
}

// ─── Fact aggregation (raw period totals) ────────────────────────────────────

export interface FactPeriod {
  from?: string;
  to?: string;
}

function inPeriod(dateIso: string, period: FactPeriod): boolean {
  const d = new Date(dateIso).getTime();
  if (period.from && d < new Date(period.from).getTime()) return false;
  if (period.to && d > new Date(period.to).getTime()) return false;
  return true;
}

export function calculateFact(
  product: Product,
  transactions: Transaction[],
  period: FactPeriod = {},
  taxRatePct = 0,
): UnitEconomicsFact {
  const txs = transactions.filter(
    (t) =>
      (t.productId === product.id ||
        (t.sku && t.sku.toLowerCase() === product.sku.toLowerCase())) &&
      inPeriod(t.date, period),
  );

  const sumBy = (type: string) =>
    txs.filter((t) => t.type === type).reduce((acc, t) => acc + t.amount, 0);

  const revenue = sumBy("SALE") + sumBy("SUBSIDY");
  const commission = Math.abs(sumBy("COMMISSION"));
  const logistics = Math.abs(sumBy("LOGISTICS"));
  const storage = Math.abs(sumBy("STORAGE"));
  const advertising = Math.abs(sumBy("ADVERTISING"));
  const penalties = Math.abs(sumBy("PENALTY"));
  const refunds = Math.abs(sumBy("REFUND"));
  const others = Math.abs(
    txs
      .filter((t) => t.type === "OTHER" && t.amount < 0)
      .reduce((acc, t) => acc + t.amount, 0),
  );
  const acquiring = 0;

  const unitsSold = txs.filter((t) => t.type === "SALE").length;
  const unitsRefunded = txs.filter((t) => t.type === "REFUND").length;
  const unitsRedeemed = Math.max(0, unitsSold - unitsRefunded);

  const costOfGoods = product.purchasePrice * unitsSold;
  const tax = taxRatePct > 0 ? (revenue * taxRatePct) / 100 : 0;

  const grossProfit =
    revenue -
    commission -
    logistics -
    storage -
    advertising -
    penalties -
    refunds -
    others -
    acquiring -
    tax -
    costOfGoods;
  const marginPct = revenue > 0 ? (grossProfit / revenue) * 100 : 0;
  const roiPct = costOfGoods > 0 ? (grossProfit / costOfGoods) * 100 : 0;

  return {
    productId: product.id,
    revenue,
    commission,
    logistics,
    storage,
    advertising,
    penalties,
    refunds,
    others,
    acquiring,
    tax,
    costOfGoods,
    grossProfit,
    marginPct,
    roiPct,
    unitsSold,
    unitsRedeemed,
  };
}

// ─── Model 2 & 3: Per-unit breakdowns ────────────────────────────────────────

function buildPerUnit(
  fact: UnitEconomicsFact,
  unitsBase: number,
  purchasePrice: number,
  model: "MODEL2" | "MODEL3",
  redemptionRate: number,
): UnitEconomicsPerUnit {
  const div = (n: number) => n / unitsBase;
  const revenue = div(fact.revenue);
  const commission = div(fact.commission);
  const logistics = div(fact.logistics);
  const storage = div(fact.storage);
  const advertising = div(fact.advertising);
  const acquiring = div(fact.acquiring);
  const penalties = div(fact.penalties);
  const tax = div(fact.tax);
  const costOfGoods = purchasePrice;

  const grossProfit =
    revenue - commission - logistics - storage - advertising - acquiring - penalties - tax - costOfGoods;
  const marginPct = revenue > 0 ? (grossProfit / revenue) * 100 : 0;
  const roiPct = costOfGoods > 0 ? (grossProfit / costOfGoods) * 100 : 0;

  return {
    model,
    unitsBase,
    redemptionRate,
    revenue,
    commission,
    logistics,
    storage,
    advertising,
    acquiring,
    penalties,
    tax,
    costOfGoods,
    grossProfit,
    marginPct,
    roiPct,
  };
}

/**
 * Model 2: distributes all period costs over actually redeemed units
 * (SALE count − REFUND count). Returns null when unitsRedeemed = 0.
 */
export function calculateModel2PerUnit(
  fact: UnitEconomicsFact,
  purchasePrice: number,
): UnitEconomicsPerUnit | null {
  if (fact.unitsRedeemed <= 0) return null;
  const redemptionRate =
    fact.unitsSold > 0 ? fact.unitsRedeemed / fact.unitsSold : 0;
  return buildPerUnit(fact, fact.unitsRedeemed, purchasePrice, "MODEL2", redemptionRate);
}

/**
 * Model 3: distributes costs over unitsSold × redemptionRate.
 * Used when redemptions are still in-flight (current moment estimate).
 * Returns null when the effective base is zero.
 */
export function calculateModel3PerUnit(
  fact: UnitEconomicsFact,
  purchasePrice: number,
  redemptionRate: number,
): UnitEconomicsPerUnit | null {
  const unitsBase = fact.unitsSold * Math.max(0, Math.min(1, redemptionRate));
  if (unitsBase <= 0) return null;
  return buildPerUnit(fact, unitsBase, purchasePrice, "MODEL3", redemptionRate);
}

// ─── Plan vs Per-unit comparison ─────────────────────────────────────────────

export function comparePlanFact(
  plan: UnitEconomicsPlan,
  perUnit: UnitEconomicsPerUnit,
) {
  const deltaPct = (factVal: number, planVal: number) =>
    planVal === 0 ? 0 : ((factVal - planVal) / Math.abs(planVal)) * 100;

  return {
    revenue: deltaPct(perUnit.revenue, plan.revenue),
    commission: deltaPct(perUnit.commission, plan.commission),
    logistics: deltaPct(perUnit.logistics, plan.logistics),
    storage: deltaPct(perUnit.storage, plan.storage),
    tax: deltaPct(perUnit.tax, plan.tax),
    grossProfit: deltaPct(perUnit.grossProfit, plan.grossProfit),
    marginPct: perUnit.marginPct - plan.marginPct,
    roiPct: perUnit.roiPct - plan.roiPct,
  };
}

// ─── Store-level aggregates ───────────────────────────────────────────────────

export function aggregateFactByStore(
  storeId: string,
  products: Product[],
  transactions: Transaction[],
  period: FactPeriod = {},
  taxRatePct = 0,
) {
  const storeProducts = products.filter((p) => p.storeId === storeId);
  return storeProducts
    .map((p) => calculateFact(p, transactions, period, taxRatePct))
    .filter((f) => f.revenue !== 0 || f.unitsSold > 0);
}

export function totalsByStore(
  store: Store,
  products: Product[],
  transactions: Transaction[],
  period: FactPeriod = {},
  taxRatePct = 0,
) {
  const storeProducts = products.filter((p) => p.storeId === store.id);
  const facts = storeProducts.map((p) => calculateFact(p, transactions, period, taxRatePct));

  // Advertising transactions from Performance API have no productId/sku,
  // so they are invisible to calculateFact. Sum them directly at store level.
  const storeLevelAds = transactions
    .filter(
      (t) =>
        t.storeId === store.id &&
        t.type === "ADVERTISING" &&
        !t.productId &&
        !t.sku &&
        inPeriod(t.date, period),
    )
    .reduce((sum, t) => sum + Math.abs(t.amount), 0);

  const totals = facts.reduce(
    (acc, f) => {
      acc.revenue += f.revenue;
      acc.commission += f.commission;
      acc.logistics += f.logistics;
      acc.storage += f.storage;
      acc.advertising += f.advertising;
      acc.penalties += f.penalties;
      acc.refunds += f.refunds;
      acc.others += f.others;
      acc.tax += f.tax;
      acc.costOfGoods += f.costOfGoods;
      acc.grossProfit += f.grossProfit;
      acc.unitsSold += f.unitsSold;
      acc.unitsRedeemed += f.unitsRedeemed;
      return acc;
    },
    {
      revenue: 0,
      commission: 0,
      logistics: 0,
      storage: 0,
      advertising: storeLevelAds,
      penalties: 0,
      refunds: 0,
      others: 0,
      tax: 0,
      costOfGoods: 0,
      grossProfit: 0,
      unitsSold: 0,
      unitsRedeemed: 0,
    },
  );

  // Subtract store-level advertising from grossProfit
  totals.grossProfit -= storeLevelAds;

  const marginPct =
    totals.revenue > 0 ? (totals.grossProfit / totals.revenue) * 100 : 0;
  return { ...totals, marginPct, products: storeProducts.length };
}
