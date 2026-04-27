import type {
  Product,
  Store,
  Tariff,
  TariffType,
  Transaction,
  UnitEconomicsFact,
  UnitEconomicsPlan,
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
  // Prefer exact category match
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
  // cm * cm * cm = cm³ → liters: divide by 1000
  return (p.lengthCm * p.widthCm * p.heightCm) / 1000;
}

export function calculatePlan(
  product: Product,
  tariffs: Tariff[],
  ctx: EconomicsContext = DEFAULT_CONTEXT,
  date: string = new Date().toISOString(),
): UnitEconomicsPlan {
  const revenue = product.sellingPrice;
  const cat = product.category || "*";

  const commissionTariff = findTariff(
    tariffs,
    product.storeId,
    "COMMISSION",
    cat,
    date,
  );
  const acquiringTariff = findTariff(
    tariffs,
    product.storeId,
    "ACQUIRING",
    cat,
    date,
  );
  const logisticsTariff = findTariff(
    tariffs,
    product.storeId,
    "LOGISTICS",
    cat,
    date,
  );
  const storageTariff = findTariff(
    tariffs,
    product.storeId,
    "STORAGE",
    cat,
    date,
  );
  const lastMileTariff = findTariff(
    tariffs,
    product.storeId,
    "LAST_MILE",
    cat,
    date,
  );

  const commission = commissionTariff
    ? (revenue * commissionTariff.value) / 100
    : 0;
  const acquiring = acquiringTariff
    ? (revenue * acquiringTariff.value) / 100
    : 0;

  // Logistics = fixed amount; if formula contains "weight" we apply per-kg multiplier
  let logistics = 0;
  if (logisticsTariff) {
    if (logisticsTariff.formula?.toLowerCase().includes("weight")) {
      logistics = logisticsTariff.value * Math.max(0.1, product.weightKg);
    } else if (logisticsTariff.formula?.toLowerCase().includes("volume")) {
      logistics = logisticsTariff.value * productVolumeLiters(product);
    } else {
      logistics = logisticsTariff.value;
    }
  }

  const liters = productVolumeLiters(product);
  const storage = storageTariff
    ? liters * storageTariff.value * ctx.storageDays
    : 0;
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
    txs
      .filter((t) => t.type === type)
      .reduce((acc, t) => acc + t.amount, 0);

  const revenue = sumBy("SALE") + sumBy("SUBSIDY");
  const commission = Math.abs(sumBy("COMMISSION"));
  const logistics = Math.abs(sumBy("LOGISTICS"));
  const storage = Math.abs(sumBy("STORAGE"));
  const penalties = Math.abs(sumBy("PENALTY"));
  const refunds = Math.abs(sumBy("REFUND"));
  const others = Math.abs(
    txs
      .filter((t) => t.type === "OTHER" && t.amount < 0)
      .reduce((acc, t) => acc + t.amount, 0),
  );
  const acquiring = 0; // Not always exposed in fact transactions; placeholder

  const unitsSold = txs.filter((t) => t.type === "SALE").length;
  const costOfGoods = product.purchasePrice * unitsSold;

  const grossProfit =
    revenue -
    commission -
    logistics -
    storage -
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
    penalties,
    refunds,
    others,
    acquiring,
    costOfGoods,
    grossProfit,
    marginPct,
    roiPct,
    unitsSold,
  };
}

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

export function comparePlanFact(
  plan: UnitEconomicsPlan,
  fact: UnitEconomicsFact,
) {
  const factPerUnit =
    fact.unitsSold > 0
      ? {
          revenue: fact.revenue / fact.unitsSold,
          commission: fact.commission / fact.unitsSold,
          logistics: fact.logistics / fact.unitsSold,
          storage: fact.storage / fact.unitsSold,
          costOfGoods: fact.costOfGoods / fact.unitsSold,
          grossProfit: fact.grossProfit / fact.unitsSold,
        }
      : null;

  const deltaPct = (factVal: number, planVal: number) =>
    planVal === 0 ? 0 : ((factVal - planVal) / Math.abs(planVal)) * 100;

  return {
    factPerUnit,
    deltas: factPerUnit
      ? {
          revenue: deltaPct(factPerUnit.revenue, plan.revenue),
          commission: deltaPct(factPerUnit.commission, plan.commission),
          logistics: deltaPct(factPerUnit.logistics, plan.logistics),
          storage: deltaPct(factPerUnit.storage, plan.storage),
          grossProfit: deltaPct(factPerUnit.grossProfit, plan.grossProfit),
          marginPct: fact.marginPct - plan.marginPct,
          roiPct: fact.roiPct - plan.roiPct,
        }
      : null,
  };
}

export function totalsByStore(
  store: Store,
  products: Product[],
  transactions: Transaction[],
  period: FactPeriod = {},
) {
  const storeProducts = products.filter((p) => p.storeId === store.id);
  const facts = storeProducts.map((p) => calculateFact(p, transactions, period));
  const totals = facts.reduce(
    (acc, f) => {
      acc.revenue += f.revenue;
      acc.commission += f.commission;
      acc.logistics += f.logistics;
      acc.storage += f.storage;
      acc.penalties += f.penalties;
      acc.refunds += f.refunds;
      acc.others += f.others;
      acc.costOfGoods += f.costOfGoods;
      acc.grossProfit += f.grossProfit;
      acc.unitsSold += f.unitsSold;
      return acc;
    },
    {
      revenue: 0,
      commission: 0,
      logistics: 0,
      storage: 0,
      penalties: 0,
      refunds: 0,
      others: 0,
      costOfGoods: 0,
      grossProfit: 0,
      unitsSold: 0,
    },
  );
  const marginPct =
    totals.revenue > 0 ? (totals.grossProfit / totals.revenue) * 100 : 0;
  return { ...totals, marginPct, products: storeProducts.length };
}
