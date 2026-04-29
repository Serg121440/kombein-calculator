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
const TX_PAGE_LIMIT = 10; // max pages fetched per sync (10k transactions)

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
    items: Array<{ sku: number; name: string; offer_id?: string }>;
  };
  amount: number;
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
  productIds: number[],
): Promise<InfoItem[]> {
  const h = hdrs(apiKey, clientId);
  const all: InfoItem[] = [];

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
    all.push(...(data.result?.items ?? []));
    if (i + INFO_BATCH < productIds.length) await sleep(REQUEST_GAP_MS);
  }

  return all;
}

// ─── Product prices — cursor pagination ──────────────────────────────────────

async function fetchProductPrices(
  apiKey: string,
  clientId: string,
  productIds: number[],
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
          filter: { product_id: productIds, visibility: "ALL" },
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

// ─── Unified product fetch ────────────────────────────────────────────────────

export async function fetchAllProducts(
  apiKey: string,
  clientId: string,
): Promise<OzonProduct[]> {
  const listItems = await fetchProductIds(apiKey, clientId);
  if (listItems.length === 0) return [];

  const productIds = listItems.map((i) => i.product_id);

  // Info and prices can be fetched in parallel (different endpoints).
  // Both are best-effort — a 404 or permissions error must not abort the sync.
  const [infoItems, priceItems] = await Promise.all([
    fetchProductInfo(apiKey, clientId, productIds).catch((e: Error) => {
      console.warn("[ozon] product/info/list failed (non-fatal):", e.message);
      return [] as InfoItem[];
    }),
    fetchProductPrices(apiKey, clientId, productIds).catch((e: Error) => {
      console.warn("[ozon] product/info/prices failed (non-fatal):", e.message);
      return [] as PriceItem[];
    }),
  ]);

  const infoMap = new Map(infoItems.map((i) => [i.id, i]));
  const priceMap = new Map(priceItems.map((i) => [i.product_id, i]));

  return listItems.map((li) => {
    const info = infoMap.get(li.product_id);
    const price = priceMap.get(li.product_id);

    // Ozon returns dimensions in mm and weight in g
    const dimUnit = info?.dimension_unit ?? "mm";
    const weightUnit = info?.weight_unit ?? "g";
    const dimF = dimUnit === "mm" ? 0.1 : 1;
    const wF = weightUnit === "g" ? 0.001 : 1;

    return {
      product_id: li.product_id,
      offer_id: li.offer_id,
      name: info?.name ?? li.offer_id,
      selling_price: parseFloat(price?.price?.price ?? "0") || 0,
      min_price: parseFloat(price?.price?.min_price ?? "0") || 0,
      depth_cm: (info?.depth ?? 0) * dimF,
      width_cm: (info?.width ?? 0) * dimF,
      height_cm: (info?.height ?? 0) * dimF,
      weight_kg: (info?.weight ?? 0) * wF,
      fbo_sku: info?.fbo_sku ?? 0,
      fbs_sku: info?.fbs_sku ?? 0,
    };
  });
}
