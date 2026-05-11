/**
 * Ozon Seller API client (server-only).
 *
 * Limits (conservative, per Ozon docs):
 *   - General: ~10 req/s per account → we use 350 ms gap ≈ 2.8 req/s
 *   - product/info/list: batch up to 1 000 product_ids per call
 *   - finance/transaction/list: up to 1 000 rows per page, paginated
 *
 * Auth: Client-Id + Api-Key request headers.
 */

import { apiFetch, parseJson } from "./http";

const BASE = "https://api-seller.ozon.ru";
const REQUEST_GAP_MS = 350; // gap between paginated calls
const PAGE_SIZE = 1_000;
const INFO_BATCH = 1_000;
const TX_PAGE_LIMIT = 200; // 200 pages × 1000 rows = 200k transactions max

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function hdrs(apiKey: string, clientId: string): Record<string, string> {
  return {
    "Client-Id": clientId,
    "Api-Key": apiKey,
    "Content-Type": "application/json",
    "User-Agent": "kombein-calculator/1.0",
  };
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface ListItem {
  product_id: number;
  offer_id: string;
}

interface InfoItem {
  id: number;
  offer_id: string;
  name: string;
  /** FBO listing SKU — matches sku field in finance/transaction/list items */
  fbo_sku?: number;
  /** FBS listing SKU — matches sku field in finance/transaction/list items */
  fbs_sku?: number;
  depth: number;
  width: number;
  height: number;
  weight: number;
  dimension_unit?: string;
  weight_unit?: string;
  type_id?: number;
  description_category_id?: number;
  /** Selling price returned directly in product/info/list response */
  price?: string;
  min_price?: string;
  old_price?: string;
}

interface CategoryTreeNode {
  description_category_id: number;
  category_name: string;
  disabled?: boolean;
  children?: CategoryTreeNode[];
  type?: Array<{ type_id: number; type_name: string; disabled?: boolean }>;
}

interface PriceItem {
  product_id: number;
  offer_id: string;
  price: { price: string; min_price?: string };
}

export interface OzonOperation {
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
  /** Gross accrual for the sale before commission */
  accruals_for_sale?: number;
  /** Marketplace commission (negative value) */
  sale_commission?: number;
  /** Per-service fee breakdown embedded in this operation */
  services?: Array<{ name: string; price: number }>;
  type?: string;
}

export interface OzonProduct {
  product_id: number;
  offer_id: string;
  name: string;
  selling_price: number;
  min_price: number;
  depth_cm: number;
  width_cm: number;
  height_cm: number;
  weight_kg: number;
  /** Ozon FBO listing SKU — used to link transactions to products */
  fbo_sku: number;
  /** Ozon FBS listing SKU — used to link transactions to products */
  fbs_sku: number;
  /** Ozon product type name (Тип товара) — used for tariff matching */
  type_name: string;
}

// ─── Product list — cursor pagination ────────────────────────────────────────

async function fetchProductIds(
  apiKey: string,
  clientId: string,
): Promise<ListItem[]> {
  const h = hdrs(apiKey, clientId);
  const all: ListItem[] = [];
  let lastId = "";

  for (;;) {
    const res = await apiFetch(
      `${BASE}/v3/product/list`,
      {
        method: "POST",
        headers: h,
        body: JSON.stringify({
          filter: { visibility: "ALL" },
          last_id: lastId,
          limit: PAGE_SIZE,
        }),
      },
      { label: "ozon:product/list" },
    );
    const data = await parseJson<{ result: { items: ListItem[]; last_id: string } }>(res);
    const items = data.result?.items ?? [];
    all.push(...items);
    lastId = data.result?.last_id ?? "";
    if (items.length < PAGE_SIZE || !lastId) break;
    await sleep(REQUEST_GAP_MS);
  }

  return all;
}

// ─── Product info — batched ───────────────────────────────────────────────────

async function fetchProductInfo(
  apiKey: string,
  clientId: string,
  listItems: ListItem[],
): Promise<InfoItem[]> {
  const h = hdrs(apiKey, clientId);
  const all: InfoItem[] = [];
  const productIds = listItems.map((i) => i.product_id);

  for (let i = 0; i < productIds.length; i += INFO_BATCH) {
    const batch = productIds.slice(i, i + INFO_BATCH);
    const res = await apiFetch(
      `${BASE}/v3/product/info/list`,
      {
        method: "POST",
        headers: h,
        body: JSON.stringify({ offer_id: [], product_id: batch, sku: [] }),
      },
      { label: "ozon:product/info/list" },
    );
    const data = await parseJson<{ result: { items: InfoItem[] } }>(res);
    const items = data.result?.items ?? [];
    console.log(
      `[ozon:product/info] batch=${batch.length} got=${items.length}` +
      (items[0] ? ` first={id:${items[0].id},name:${JSON.stringify(items[0].name)},type_id:${items[0].type_id}}` : ""),
    );
    all.push(...items);
    if (i + INFO_BATCH < productIds.length) await sleep(REQUEST_GAP_MS);
  }

  return all;
}

// ─── Product prices — cursor pagination ──────────────────────────────────────

async function fetchProductPrices(
  apiKey: string,
  clientId: string,
): Promise<PriceItem[]> {
  const h = hdrs(apiKey, clientId);
  const all: PriceItem[] = [];
  let lastId = "";

  for (;;) {
    const res = await apiFetch(
      `${BASE}/v4/product/info/prices`,
      {
        method: "POST",
        headers: h,
        body: JSON.stringify({
          filter: { visibility: "ALL" },
          last_id: lastId,
          limit: PAGE_SIZE,
        }),
      },
      { label: "ozon:product/info/prices" },
    );
    const data = await parseJson<{ result: { items: PriceItem[]; last_id: string } }>(res);
    const items = data.result?.items ?? [];
    all.push(...items);
    lastId = data.result?.last_id ?? "";
    if (items.length < PAGE_SIZE || !lastId) break;
    await sleep(REQUEST_GAP_MS);
  }

  return all;
}

// ─── Transactions — page pagination ──────────────────────────────────────────

export async function fetchTransactions(
  apiKey: string,
  clientId: string,
  from: string,
  to: string,
): Promise<{ operations: OzonOperation[]; warning?: string }> {
  const h = hdrs(apiKey, clientId);
  const all: OzonOperation[] = [];
  let page = 1;
  let totalPages = 1;

  do {
    const res = await apiFetch(
      `${BASE}/v3/finance/transaction/list`,
      {
        method: "POST",
        headers: h,
        body: JSON.stringify({
          filter: {
            date: { from, to },
            operation_type: [],
            posting_number: "",
            transaction_type: "all",
          },
          page,
          page_size: PAGE_SIZE,
        }),
      },
      { label: `ozon:finance/transaction/list p${page}`, timeoutMs: 45_000 },
    );

    if (!res.ok) {
      const text = await res.text();
      console.warn(`[ozon:transactions] ${res.status}: ${text.slice(0, 200)}`);
      return {
        operations: all,
        warning: `Транзакции Ozon недоступны (${res.status}): ${text.slice(0, 200)}`,
      };
    }

    const data = await parseJson<{
      result: { operations: OzonOperation[]; page_count: number; row_count: number };
    }>(res);

    const ops = data.result?.operations ?? [];
    all.push(...ops);
    totalPages = data.result?.page_count ?? 1;

    if (page < totalPages && page < TX_PAGE_LIMIT) {
      await sleep(REQUEST_GAP_MS);
    }
    page++;
  } while (page <= totalPages && page <= TX_PAGE_LIMIT);

  return { operations: all };
}

// ─── Category tree → type_id → type_name map ─────────────────────────────────

function flattenTypeNames(nodes: CategoryTreeNode[], out: Map<number, string>): void {
  for (const node of nodes) {
    for (const t of node.type ?? []) {
      if (!t.disabled) out.set(t.type_id, t.type_name);
    }
    if (node.children?.length) flattenTypeNames(node.children, out);
  }
}

async function fetchTypeNameMap(
  apiKey: string,
  clientId: string,
): Promise<Map<number, string>> {
  const h = hdrs(apiKey, clientId);
  try {
    const res = await apiFetch(
      `${BASE}/v4/category/tree`,
      {
        method: "POST",
        headers: h,
        body: JSON.stringify({ description_category_id: 0, language: "RU" }),
      },
      { label: "ozon:category/tree" },
    );
    const data = await parseJson<{ result: CategoryTreeNode[] }>(res);
    const map = new Map<number, string>();
    flattenTypeNames(data.result ?? [], map);
    return map;
  } catch (e: unknown) {
    console.warn("[ozon] category/tree failed (non-fatal):", (e as Error).message);
    return new Map();
  }
}

// ─── Unified product fetch ────────────────────────────────────────────────────

export async function fetchAllProducts(
  apiKey: string,
  clientId: string,
): Promise<{ products: OzonProduct[]; warnings: string[] }> {
  const warnings: string[] = [];
  const listItems = await fetchProductIds(apiKey, clientId);
  if (listItems.length === 0) return { products: [], warnings };

  // Info, prices and category tree fetched in parallel. All best-effort.
  const [infoItems, priceItems, typeNameMap] = await Promise.all([
    fetchProductInfo(apiKey, clientId, listItems).catch((e: Error) => {
      warnings.push(`Названия/габариты недоступны: ${e.message}`);
      return [] as InfoItem[];
    }),
    // /v4/product/info/prices is optional — prices also embedded in info response
    fetchProductPrices(apiKey, clientId).catch(() => [] as PriceItem[]),
    fetchTypeNameMap(apiKey, clientId),
  ]);

  console.log(
    `[ozon:products] list=${listItems.length} info=${infoItems.length} prices=${priceItems.length} categories=${typeNameMap.size}`,
  );

  // Map info by product_id (primary) and offer_id (fallback)
  const infoById = new Map(infoItems.map((i) => [i.id, i]));
  const infoByOfferId = new Map(infoItems.map((i) => [i.offer_id, i]));
  const priceMap = new Map(priceItems.map((i) => [i.product_id, i]));

  const products = listItems.map((li) => {
    const info = infoById.get(li.product_id) ?? infoByOfferId.get(li.offer_id);
    const priceItem = priceMap.get(li.product_id);

    const dimUnit = info?.dimension_unit ?? "mm";
    const weightUnit = info?.weight_unit ?? "g";
    const dimF = dimUnit === "mm" ? 0.1 : 1;
    const wF = weightUnit === "g" ? 0.001 : 1;

    const typeId = info?.type_id;
    const typeName = typeId ? (typeNameMap.get(typeId) ?? "") : "";

    // Price: prefer dedicated prices API, fall back to price embedded in info response
    const sellingPrice =
      parseFloat(priceItem?.price?.price ?? "0") ||
      parseFloat(info?.price ?? "0") ||
      0;
    const minPrice =
      parseFloat(priceItem?.price?.min_price ?? "0") ||
      parseFloat(info?.min_price ?? "0") ||
      0;

    return {
      product_id: li.product_id,
      offer_id: li.offer_id,
      name: info?.name ?? li.offer_id,
      selling_price: sellingPrice,
      min_price: minPrice,
      depth_cm: (info?.depth ?? 0) * dimF,
      width_cm: (info?.width ?? 0) * dimF,
      height_cm: (info?.height ?? 0) * dimF,
      weight_kg: (info?.weight ?? 0) * wF,
      fbo_sku: info?.fbo_sku ?? 0,
      fbs_sku: info?.fbs_sku ?? 0,
      type_name: typeName,
    };
  });

  return { products, warnings };
}
