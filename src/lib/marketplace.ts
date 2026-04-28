"use client";

import type { Product, Store, Transaction, TransactionType } from "./types";

function decodeKey(encoded: string): string {
  try {
    return typeof atob !== "undefined" ? atob(encoded) : encoded;
  } catch {
    return encoded;
  }
}

// ─── Ozon ────────────────────────────────────────────────────────────────────

const OZON_OP_TYPE_MAP: Record<string, TransactionType> = {
  OperationAgentDeliveredToCustomer: "SALE",
  OperationReturnGoodsFulfillmentCustomerByCourier: "REFUND",
  ClientReturnAgentOperation: "REFUND",
  MarketplaceServiceItemFulfillment: "LOGISTICS",
  MarketplaceServiceItemDeliveryKGT: "LOGISTICS",
  MarketplaceServiceItemDirectFlowTrans: "LOGISTICS",
  MarketplaceServiceItemDropoffFF: "LOGISTICS",
  MarketplaceServiceItemDropoffPVZ: "LOGISTICS",
  MarketplaceServiceItemDropoffSC: "LOGISTICS",
  MarketplaceServiceItemReturnFlowTrans: "LOGISTICS",
  MarketplaceServiceItemFeeReturnFlowTrans: "LOGISTICS",
  MarketplaceServiceItemStorageFee: "STORAGE",
  MarketplaceServiceItemReturnAfterDecision: "STORAGE",
  OperationClaim: "PENALTY",
  MarketplaceSellerCompensationReturnsToPurPoint: "SUBSIDY",
  MarketplaceSellerReexchangeCompensation: "SUBSIDY",
};

function classifyOzonOperation(opType: string, amount: number): TransactionType {
  const mapped = OZON_OP_TYPE_MAP[opType];
  if (mapped) return mapped;
  if (opType.toLowerCase().includes("commission")) return "COMMISSION";
  if (opType.toLowerCase().includes("sale") || opType.toLowerCase().includes("delivered")) return "SALE";
  if (opType.toLowerCase().includes("return")) return "REFUND";
  if (opType.toLowerCase().includes("storage")) return "STORAGE";
  if (opType.toLowerCase().includes("delivery") || opType.toLowerCase().includes("logistics")) return "LOGISTICS";
  if (opType.toLowerCase().includes("penalty") || opType.toLowerCase().includes("fine")) return "PENALTY";
  return amount >= 0 ? "SALE" : "OTHER";
}

interface OzonProductInfo {
  product_id: number;
  offer_id: string;
  name: string;
  selling_price: number;
  min_price: number;
  depth_cm: number;
  width_cm: number;
  height_cm: number;
  weight_kg: number;
}

interface OzonOperation {
  operation_id: number;
  operation_type: string;
  operation_date: string;
  posting: { posting_number: string; items: Array<{ sku: number; name: string }> };
  amount: number;
}

async function syncOzon(
  store: Store,
  existingProducts: Product[],
): Promise<{ products: Omit<Product, "id" | "createdAt">[]; transactions: Omit<Transaction, "id">[]; warning?: string }> {
  const apiKey = decodeKey(store.apiKeyEncoded!);
  const clientId = store.clientId!;

  // Sync products
  const prodRes = await fetch("/api/ozon/products", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apiKey, clientId }),
  });
  if (!prodRes.ok) {
    const err = await prodRes.json().catch(() => ({ error: prodRes.statusText }));
    throw new Error(err.error ?? "Ошибка получения товаров Ozon");
  }
  const prodData = (await prodRes.json()) as { products: OzonProductInfo[] };
  const existingSkus = new Set(
    existingProducts.filter((p) => p.storeId === store.id).map((p) => p.sku),
  );
  const newProducts: Omit<Product, "id" | "createdAt">[] = (prodData.products ?? [])
    .filter((p) => !existingSkus.has(String(p.offer_id)))
    .map((p) => ({
      storeId: store.id,
      sku: String(p.offer_id),
      name: p.name ?? `Товар ${p.product_id}`,
      category: "",
      purchasePrice: 0,
      sellingPrice: p.selling_price,
      weightKg: p.weight_kg,
      lengthCm: p.depth_cm,
      widthCm: p.width_cm,
      heightCm: p.height_cm,
      active: true,
    }));

  // Sync transactions (last 30 days) — non-fatal: 404/403 returns empty list
  const txRes = await fetch("/api/ozon/transactions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apiKey, clientId }),
  });
  const txData = (await txRes.json().catch(() => ({}))) as {
    operations?: OzonOperation[];
    warning?: string;
  };
  const skuMap = new Map(
    existingProducts
      .concat(
        newProducts.map((p) => ({ ...p, id: "", createdAt: "" })),
      )
      .filter((p) => p.storeId === store.id)
      .map((p) => [p.sku, p.id]),
  );

  const transactions: Omit<Transaction, "id">[] = (txData.operations ?? []).map((op) => {
    // Ozon items have offer_id (string SKU), not numeric sku
    const offerItem = op.posting?.items?.[0] as unknown as { offer_id?: string; sku?: number };
    const postingSku = offerItem?.offer_id ?? String(offerItem?.sku ?? "");
    return {
      storeId: store.id,
      sku: postingSku || undefined,
      productId: postingSku ? skuMap.get(postingSku) : undefined,
      orderId: op.posting?.posting_number ?? String(op.operation_id),
      date: op.operation_date ?? new Date().toISOString(),
      type: classifyOzonOperation(op.operation_type, op.amount),
      amount: op.amount,
      description: op.operation_type,
      rawData: op as unknown as Record<string, unknown>,
    };
  });

  return { products: newProducts, transactions, warning: txData.warning };
}

// ─── Wildberries ──────────────────────────────────────────────────────────────

interface WbCard {
  nmID: number;
  vendorCode: string;
  title: string;
  subjectName: string;
  salePriceU?: number;
  dimensions?: { length: number; width: number; height: number; weightGross: number };
}

interface WbRow {
  nm_id: number;
  sa_name: string;
  subject_name: string;
  doc_type_name: string;
  supplier_oper_name: string;
  order_dt: string;
  sale_dt: string;
  ppvz_for_pay: number;
  delivery_rub: number;
  storage_fee: number;
  penalty: number;
  additional_payment: number;
  rrd_id: number;
  srid: string;
}

function classifyWbRow(row: WbRow): TransactionType {
  const docType = (row.doc_type_name ?? "").toLowerCase();
  const opName = (row.supplier_oper_name ?? "").toLowerCase();
  if (docType.includes("продажа") || opName.includes("продажа")) return "SALE";
  if (docType.includes("возврат") || opName.includes("возврат")) return "REFUND";
  if (opName.includes("логистика") || opName.includes("доставка")) return "LOGISTICS";
  if (opName.includes("хранение")) return "STORAGE";
  if (opName.includes("штраф") || opName.includes("санкция")) return "PENALTY";
  return "OTHER";
}

async function syncWb(
  store: Store,
  existingProducts: Product[],
): Promise<{ products: Omit<Product, "id" | "createdAt">[]; transactions: Omit<Transaction, "id">[]; warning?: string }> {
  const apiKey = decodeKey(store.apiKeyEncoded!);

  // Products
  const prodRes = await fetch("/api/wb/products", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apiKey }),
  });
  if (!prodRes.ok) {
    const err = await prodRes.json().catch(() => ({ error: prodRes.statusText }));
    throw new Error(err.error ?? "Ошибка получения товаров WB");
  }
  const prodData = (await prodRes.json()) as { cards: WbCard[] };
  const existingSkus = new Set(
    existingProducts.filter((p) => p.storeId === store.id).map((p) => p.sku),
  );
  const newProducts: Omit<Product, "id" | "createdAt">[] = (prodData.cards ?? [])
    .filter((c) => !existingSkus.has(c.vendorCode))
    .map((c) => ({
      storeId: store.id,
      sku: c.vendorCode,
      name: c.title ?? `Товар ${c.nmID}`,
      category: c.subjectName ?? "",
      purchasePrice: 0,
      sellingPrice: c.salePriceU ? c.salePriceU / 100 : 0,
      weightKg: c.dimensions ? c.dimensions.weightGross / 1000 : 0,
      lengthCm: c.dimensions?.length ?? 0,
      widthCm: c.dimensions?.width ?? 0,
      heightCm: c.dimensions?.height ?? 0,
      active: true,
    }));

  // Transactions
  const txRes = await fetch("/api/wb/transactions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apiKey }),
  });
  const txData = txRes.ok
    ? ((await txRes.json().catch(() => ({}))) as { rows?: WbRow[]; warning?: string })
    : { rows: [], warning: `WB транзакции недоступны (${txRes.status})` };

  const transactions: Omit<Transaction, "id">[] = [];
  for (const row of txData.rows ?? []) {
    const sku = String(row.sa_name ?? "");
    const date = row.sale_dt ?? row.order_dt ?? new Date().toISOString();
    const orderId = String(row.srid ?? row.rrd_id);

    if (row.ppvz_for_pay !== 0) {
      transactions.push({
        storeId: store.id,
        sku: sku || undefined,
        orderId,
        date,
        type: classifyWbRow(row),
        amount: row.ppvz_for_pay,
        description: row.supplier_oper_name,
        rawData: row as unknown as Record<string, unknown>,
      });
    }
    if (row.delivery_rub > 0) {
      transactions.push({
        storeId: store.id,
        sku: sku || undefined,
        orderId: orderId + "-log",
        date,
        type: "LOGISTICS",
        amount: -row.delivery_rub,
        description: "Логистика WB",
      });
    }
    if (row.storage_fee > 0) {
      transactions.push({
        storeId: store.id,
        sku: sku || undefined,
        orderId: orderId + "-stor",
        date,
        type: "STORAGE",
        amount: -row.storage_fee,
        description: "Хранение WB",
      });
    }
    if (row.penalty > 0) {
      transactions.push({
        storeId: store.id,
        sku: sku || undefined,
        orderId: orderId + "-pen",
        date,
        type: "PENALTY",
        amount: -row.penalty,
        description: "Штраф WB",
      });
    }
  }

  return { products: newProducts, transactions };
}

// ─── Unified sync entry point ─────────────────────────────────────────────────

export async function syncStore(
  store: Store,
  existingProducts: Product[],
): Promise<{
  products: Omit<Product, "id" | "createdAt">[];
  transactions: Omit<Transaction, "id">[];
  warning?: string;
}> {
  if (!store.apiKeyEncoded) {
    throw new Error("API-ключ не задан. Отредактируйте магазин.");
  }
  if (store.platform === "OZON") {
    if (!store.clientId) throw new Error("Client-ID не задан для Ozon.");
    return syncOzon(store, existingProducts);
  }
  return syncWb(store, existingProducts);
}
