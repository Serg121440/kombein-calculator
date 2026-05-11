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
}

const DEFAULT_CONTEXT: EconomicsContext = { storageDays: 30 };

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

// ─── Model 1: Planned unit economics ─────────────────────────────────────────

export function calculatePlan(
  product: Product,
  tariffs: Tariff[],
  ctx: EconomicsContext = DEFAULT_CONTEXT,
  date: string = new Date().toISOString(),
): UnitEconomicsPlan {
  const revenue = product.sellingPrice;
  const cat = product.category || "*";

  const commissionTariff = findTariff(tariffs, product.storeId, "COMMISSION", cat, date);
  const acquiringTariff = findTariff(tariffs, product.storeId, "ACQUIRING", cat, date);
  const logisticsTariff = findLogisticsTariff(tariffs, product, date);
  const storageTariff = findTariff(tariffs, product.storeId, "STORAGE", cat, date);
  const lastMileTariff = findTariff(tariffs, product.storeId, "LAST_MILE", cat, date);

  // Product-level commission % (from Ozon API) takes priority over generic tariff
  const commissionPct = product.commissionPct ?? commissionTariff?.value ?? 0;
  const commission = revenue > 0 ? (revenue * commissionPct) / 100 : 0;
  const acquiring = acquiringTariff ? (revenue * acquiringTariff.value) / 100 : 0;
  const logistics = logisticsTariff ? applyLogisticsTariff(logisticsTariff, product) : 0;

  const liters = productVolumeLiters(product);
  const storage = storageTariff ? liters * storageTariff.value * ctx.storageDays : 0;
  const lastMile = lastMileTariff ? lastMileTariff.value : 0;
  const costOfGoods = product.purchasePrice;

  const grossProfit =
    revenue - commission - logistics - storage - acquiring - lastMile - costOfGoods;
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
  const costOfGoods = purchasePrice;

  const grossProfit =
    revenue - commission - logistics - storage - advertising - acquiring - penalties - costOfGoods;
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
) {
  const storeProducts = products.filter((p) => p.storeId === storeId);
  return storeProducts
    .map((p) => calculateFact(p, transactions, period))
    .filter((f) => f.revenue !== 0 || f.unitsSold > 0);
}

export function totalsByStore(
  store: Store,
  products: Product[],
  transactions: Transaction[],
  period: FactPeriod = {},
) {
  const storeProducts = products.filter((p) => p.storeId === store.id);
  const facts = storeProducts.map((p) => calculateFact(p, transactions, period));

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
