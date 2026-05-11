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
  fbo_sku: number;
  fbs_sku: number;
  type_name: string;
}

interface OzonOperation {
  operation_id: number;
  operation_type: string;
  operation_date: string;
  posting: {
    posting_number: string;
    order_id?: number;
    delivery_schema?: string;
    items: Array<{ sku: number; name: string; offer_id?: string }>;
  };
  amount: number;
  accruals_for_sale?: number;
  sale_commission?: number;
  services?: Array<{ name: string; price: number }>;
}

async function syncOzon(
  store: Store,
  existingProducts: Product[],
): Promise<{
  products: Omit<Product, "id" | "createdAt">[];
  productUpdates: Array<{ id: string; patch: Partial<Product> }>;
  transactions: Omit<Transaction, "id">[];
  warning?: string;
}> {
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
  const prodData = (await prodRes.json()) as { products: OzonProductInfo[]; warnings?: string[] };
  const apiWarnings = prodData.warnings ?? [];

  const storeProducts = existingProducts.filter((p) => p.storeId === store.id);
  const existingBySkus = new Map(storeProducts.map((p) => [p.sku, p]));
  const allOzonProducts = prodData.products ?? [];

  const newProducts: Omit<Product, "id" | "createdAt">[] = [];
  const productUpdates: Array<{ id: string; patch: Partial<Product> }> = [];

  for (const p of allOzonProducts) {
    const offerId = String(p.offer_id);
    const existing = existingBySkus.get(offerId);
    const hasRealName = p.name && p.name !== offerId;

    if (!existing) {
      newProducts.push({
        storeId: store.id,
        sku: offerId,
        name: p.name ?? `Товар ${p.product_id}`,
        category: p.type_name,
        purchasePrice: 0,
        sellingPrice: p.selling_price,
        weightKg: p.weight_kg,
        lengthCm: p.depth_cm,
        widthCm: p.width_cm,
        heightCm: p.height_cm,
        active: true,
      });
    } else {
      // Refresh name, price, category, dimensions from API — but never overwrite
      // user-entered purchasePrice or active flag.
      const patch: Partial<Product> = {};
      if (hasRealName) patch.name = p.name;
      if (p.selling_price > 0) patch.sellingPrice = p.selling_price;
      if (p.type_name) patch.category = p.type_name;
      if (p.weight_kg > 0) patch.weightKg = p.weight_kg;
      if (p.depth_cm > 0) patch.lengthCm = p.depth_cm;
      if (p.width_cm > 0) patch.widthCm = p.width_cm;
      if (p.height_cm > 0) patch.heightCm = p.height_cm;
      if (Object.keys(patch).length > 0) productUpdates.push({ id: existing.id, patch });
    }
  }

  // Ozon finance API uses numeric listing SKU (fbo_sku/fbs_sku), not offer_id.
  // Build numeric_listing_sku → offer_id so we can link transactions to products.
  const listingSkuToOfferId = new Map<number, string>();
  for (const p of allOzonProducts) {
    const offerId = String(p.offer_id);
    if (p.fbo_sku) listingSkuToOfferId.set(p.fbo_sku, offerId);
    if (p.fbs_sku) listingSkuToOfferId.set(p.fbs_sku, offerId);
  }

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

  // offer_id → product.id map (includes both existing and newly synced products)
  const skuToProductId = new Map(
    existingProducts
      .concat(newProducts.map((p) => ({ ...p, id: "", createdAt: "" })))
      .filter((p) => p.storeId === store.id)
      .map((p) => [p.sku, p.id]),
  );

  const transactions: Omit<Transaction, "id">[] = [];
  for (const op of txData.operations ?? []) {
    const item = op.posting?.items?.[0];
    // Prefer explicit offer_id; fall back to resolving numeric listing SKU
    const offerId =
      (item?.offer_id || "") ||
      (item?.sku ? listingSkuToOfferId.get(item.sku) : undefined) ||
      "";

    const schema = op.posting?.delivery_schema;
    const description = schema ? `${op.operation_type} (${schema})` : op.operation_type;
    const rawData: Record<string, unknown> = {};
    if (op.accruals_for_sale) rawData.accruals_for_sale = op.accruals_for_sale;
    if (op.sale_commission) rawData.sale_commission = op.sale_commission;
    if (schema) rawData.delivery_schema = schema;
    if (op.posting?.order_id) rawData.order_id = op.posting.order_id;

    transactions.push({
      storeId: store.id,
      sku: offerId || undefined,
      productId: offerId ? skuToProductId.get(offerId) || undefined : undefined,
      orderId: op.posting?.posting_number ?? String(op.operation_id),
      date: op.operation_date ?? new Date().toISOString(),
      type: classifyOzonOperation(op.operation_type, op.amount),
      amount: op.amount,
      description,
      source: "api",
      externalId: String(op.operation_id),
      rawData: Object.keys(rawData).length > 0 ? rawData : undefined,
    });

    // Expand embedded service fees (present in FBS operations).
    // Each service is a separate charge not returned as a top-level operation for FBS.
    if (op.services?.length && schema === "FBS") {
      for (const svc of op.services) {
        if (!svc.price) continue;
        transactions.push({
          storeId: store.id,
          sku: offerId || undefined,
          productId: offerId ? skuToProductId.get(offerId) || undefined : undefined,
          orderId: op.posting?.posting_number ?? String(op.operation_id),
          date: op.operation_date ?? new Date().toISOString(),
          type: classifyOzonOperation(svc.name, svc.price),
          amount: svc.price,
          description: svc.name + " (FBS)",
          source: "api",
          externalId: `${op.operation_id}-${svc.name}`,
        });
      }
    }
  }

  // Performance API (advertising expenses)
  if (store.perfClientId && store.perfClientSecretEncoded) {
    const perfSecret = decodeKey(store.perfClientSecretEncoded);
    const dateFrom = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    const dateTo = new Date().toISOString().slice(0, 10);
    try {
      const perfRes = await fetch("/api/ozon/advertising", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ perfClientId: store.perfClientId, perfClientSecret: perfSecret, dateFrom, dateTo }),
      });
      const perfData = (await perfRes.json().catch(() => ({}))) as {
        stats?: Array<{ date: string; campaignId: string; campaignName: string; charge: number }>;
        warning?: string;
        error?: string;
      };
      if (perfData.error) {
        apiWarnings.push(`Реклама: ${perfData.error}`);
      } else {
        for (const s of perfData.stats ?? []) {
          const externalId = `perf-${s.campaignId}-${s.date}`;
          transactions.push({
            storeId: store.id,
            orderId: externalId,
            externalId,
            date: `${s.date}T00:00:00.000Z`,
            type: "ADVERTISING",
            amount: -s.charge,
            description: `Реклама: ${s.campaignName || s.campaignId}`,
            source: "api",
          });
        }
        if (perfData.warning) apiWarnings.push(`Реклама: ${perfData.warning}`);
      }
    } catch (err) {
      apiWarnings.push(`Реклама: ${(err as Error).message}`);
    }
  }

  const warnings = [txData.warning, ...apiWarnings].filter(Boolean);
  return {
    products: newProducts,
    productUpdates,
    transactions,
    warning: warnings.length > 0 ? warnings.join(" | ") : undefined,
  };
}

// ─── Wildberries ──────────────────────────────────────────────────────────────

interface WbCard {
  nmID: number;
  vendorCode: string;
  title: string;
  subjectName: string;
  /** Accurate selling price from prices API (roubles) */
  sellingPrice?: number;
  /** Fallback: price in kopecks before discount — use sellingPrice if available */
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
): Promise<{ products: Omit<Product, "id" | "createdAt">[]; productUpdates: Array<{ id: string; patch: Partial<Product> }>; transactions: Omit<Transaction, "id">[]; warning?: string; nextWbCursor?: { updatedAt: string; nmID: number } }> {
  const apiKey = decodeKey(store.apiKeyEncoded!);

  // Products — pass previous cursor for incremental sync
  const prodRes = await fetch("/api/wb/products", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apiKey, prevCursor: store.wbCardsCursor }),
  });
  if (!prodRes.ok) {
    const err = await prodRes.json().catch(() => ({ error: prodRes.statusText }));
    throw new Error(err.error ?? "Ошибка получения товаров WB");
  }
  const prodData = (await prodRes.json()) as {
    cards: WbCard[];
    nextCursor?: { updatedAt: string; nmID: number };
  };
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
      // Use accurate price from prices API; fallback to salePriceU kopecks→roubles
      sellingPrice: c.sellingPrice ?? (c.salePriceU ? c.salePriceU / 100 : 0),
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
  let txData: { rows?: WbRow[]; warning?: string };
  if (txRes.ok) {
    txData = (await txRes.json().catch(() => ({}))) as { rows?: WbRow[]; warning?: string };
  } else if (txRes.status === 401 || txRes.status === 403) {
    txData = {
      rows: [],
      warning: `WB: нет доступа к статистике (${txRes.status}). Перейдите в WB Seller → Настройки → Доступ к API → включите разрешение «Статистика» для ключа.`,
    };
  } else if (txRes.status === 404) {
    txData = {
      rows: [],
      warning: `WB: эндпоинт статистики не найден (404). Убедитесь, что у API-ключа есть разрешение «Статистика». Для загрузки транзакций используйте раздел «Отчёты» (ручная загрузка Excel).`,
    };
  } else {
    txData = { rows: [], warning: `WB: транзакции недоступны (${txRes.status})` };
  }

  const transactions: Omit<Transaction, "id">[] = [];
  for (const row of txData.rows ?? []) {
    const sku = String(row.sa_name ?? "");
    const date = row.sale_dt ?? row.order_dt ?? new Date().toISOString();
    // srid is WB's stable external ID for the sale record; rrd_id is the report row ID
    const srid = row.srid ? String(row.srid) : undefined;
    const orderId = srid ?? String(row.rrd_id);
    const base = { storeId: store.id, sku: sku || undefined, date, source: "api" as const };

    if (row.ppvz_for_pay !== 0) {
      transactions.push({
        ...base,
        orderId,
        externalId: srid ?? `wb-${row.rrd_id}`,
        type: classifyWbRow(row),
        amount: row.ppvz_for_pay,
        description: row.supplier_oper_name,
        rawData: row as unknown as Record<string, unknown>,
      });
    }
    if (row.delivery_rub > 0) {
      transactions.push({
        ...base,
        orderId: orderId + "-log",
        externalId: srid ? `${srid}-log` : `wb-${row.rrd_id}-log`,
        type: "LOGISTICS",
        amount: -row.delivery_rub,
        description: "Логистика WB",
      });
    }
    if (row.storage_fee > 0) {
      transactions.push({
        ...base,
        orderId: orderId + "-stor",
        externalId: srid ? `${srid}-stor` : `wb-${row.rrd_id}-stor`,
        type: "STORAGE",
        amount: -row.storage_fee,
        description: "Хранение WB",
      });
    }
    if (row.penalty > 0) {
      transactions.push({
        ...base,
        orderId: orderId + "-pen",
        externalId: srid ? `${srid}-pen` : `wb-${row.rrd_id}-pen`,
        type: "PENALTY",
        amount: -row.penalty,
        description: "Штраф WB",
      });
    }
  }

  return {
    products: newProducts,
    productUpdates: [],
    transactions,
    warning: txData.warning,
    nextWbCursor: prodData.nextCursor,
  };
}

// ─── Unified sync entry point ─────────────────────────────────────────────────

export async function syncStore(
  store: Store,
  existingProducts: Product[],
): Promise<{
  products: Omit<Product, "id" | "createdAt">[];
  productUpdates: Array<{ id: string; patch: Partial<Product> }>;
  transactions: Omit<Transaction, "id">[];
  warning?: string;
  /** WB only: save to store.wbCardsCursor for next incremental sync */
  nextWbCursor?: { updatedAt: string; nmID: number };
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
