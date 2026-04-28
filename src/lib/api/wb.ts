/**
 * Wildberries API client (server-only).
 *
 * Limits (per WB docs):
 *   - General: 300 req / 60 s = 5 req/s
 *   - Content category: 100 req / min → gap ≥ 700 ms between pages
 *   - Discounts/prices: 100 req / min
 *   - Statistics: очень строго (~1 тяжёлый запрос / 3 мин)
 *   - Advertising: 1 req/min для fullstats
 *   - 429: читать X-Ratelimit-Retry header
 *
 * Auth: Authorization: Bearer <token>
 * Hosts:
 *   Content    → https://content-api.wildberries.ru
 *   Prices     → https://discounts-prices-api.wildberries.ru
 *   Statistics → https://statistics-api.wildberries.ru
 *   Advert     → https://advert-api.wildberries.ru  (MISSING — не реализовано)
 */

import { apiFetch, parseJson } from "./http";

const CONTENT_BASE = "https://content-api.wildberries.ru";
const PRICES_BASE  = "https://discounts-prices-api.wildberries.ru";
const STATS_BASE   = "https://statistics-api.wildberries.ru";

const CARDS_LIMIT    = 100;       // max cards per WB request (docs: 100)
const PRICES_LIMIT   = 1_000;     // max items per prices request
const STATS_LIMIT    = 100_000;   // max rows per stats request
const CONTENT_GAP_MS = 700;       // ~1.4 req/s — well within 100/min
const PRICES_GAP_MS  = 700;
const STATS_GAP_MS   = 3_000;     // conservative for heavy stats endpoint
const STATS_MAX_PAGES = 3;        // safety: 300k rows max per sync

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function authHeader(apiKey: string): string {
  return apiKey.startsWith("Bearer ") ? apiKey : `Bearer ${apiKey}`;
}

function hdrs(apiKey: string): Record<string, string> {
  return {
    Authorization: authHeader(apiKey),
    "Content-Type": "application/json",
    "User-Agent": "kombein-calculator/1.0",
  };
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WbCard {
  nmID: number;
  vendorCode: string;
  title: string;
  subjectName: string;
  /** Цена в копейках (до скидки) — ненадёжно, используй fetchPrices() */
  salePriceU?: number;
  dimensions?: {
    length: number;
    width: number;
    height: number;
    weightGross: number;
  };
  updatedAt?: string;
}

export interface WbPrice {
  nmID: number;
  /** Цена в рублях */
  price: number;
  /** Скидка % */
  discount: number;
  /** Итоговая цена со скидкой в рублях */
  discountedPrice: number;
}

export interface WbStatRow {
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

/** Курсор для инкрементального синка карточек */
export interface WbCardsCursor {
  updatedAt: string;
  nmID: number;
}

interface CardsApiResponse {
  data?: {
    cards: WbCard[];
    cursor: { updatedAt: string; nmID: number; total: number };
  };
  cards?: WbCard[];
  error?: boolean;
  errorText?: string;
}

// ─── Products — cursor pagination с поддержкой инкрементального синка ─────────
//
// Если передать prevCursor, запрашиваются только карточки, изменившиеся
// после предыдущей синхронизации. Сохраняй возвращённый nextCursor в Store.

export async function fetchAllCards(
  apiKey: string,
  prevCursor?: WbCardsCursor,
): Promise<{ cards: WbCard[]; nextCursor: WbCardsCursor | null }> {
  const h = hdrs(apiKey);
  const all: WbCard[] = [];
  // Инкрементальный старт: с позиции прошлого синка
  let cursor: { updatedAt?: string; nmID?: number } = prevCursor
    ? { updatedAt: prevCursor.updatedAt, nmID: prevCursor.nmID }
    : {};
  let lastCursor: WbCardsCursor | null = null;

  for (;;) {
    const res = await apiFetch(
      `${CONTENT_BASE}/content/v2/get/cards/list`,
      {
        method: "POST",
        headers: h,
        body: JSON.stringify({
          settings: {
            cursor: { limit: CARDS_LIMIT, ...cursor },
            filter: { withPhoto: -1 },
          },
        }),
      },
      { label: "wb:cards/list" },
    );

    const data = await parseJson<CardsApiResponse>(res);

    if (data.error) {
      throw new Error(`WB Content API: ${data.errorText ?? "unknown error"}`);
    }

    const cards: WbCard[] = data.data?.cards ?? data.cards ?? [];
    all.push(...cards);

    const next = data.data?.cursor;
    if (next?.updatedAt) {
      lastCursor = { updatedAt: next.updatedAt, nmID: next.nmID };
    }

    if (cards.length < CARDS_LIMIT) break;
    if (!next?.updatedAt) break;

    cursor = { updatedAt: next.updatedAt, nmID: next.nmID };
    await sleep(CONTENT_GAP_MS);
  }

  return { cards: all, nextCursor: lastCursor };
}

// ─── Prices — отдельный эндпоинт, точнее чем salePriceU в карточках ──────────
//
// salePriceU в карточках = цена до скидки × 100 (копейки), часто отсутствует.
// Этот эндпоинт даёт актуальную цену с учётом скидки.

export async function fetchPrices(
  apiKey: string,
  nmIDs?: number[],
): Promise<WbPrice[]> {
  const h = hdrs(apiKey);
  const all: WbPrice[] = [];
  let offset = 0;

  for (;;) {
    const params = new URLSearchParams({
      limit: String(PRICES_LIMIT),
      offset: String(offset),
    });
    if (nmIDs?.length) {
      // API принимает nmID как query-параметры при фильтрации
      // При запросе всех товаров не фильтруем
    }

    const res = await apiFetch(
      `${PRICES_BASE}/api/v2/list/goods/filter?${params}`,
      { method: "GET", headers: h },
      { label: `wb:prices offset=${offset}` },
    );

    if (!res.ok) {
      // Цены — некритичная ошибка, вернём пустой список
      console.warn(`[wb:prices] ${res.status}`);
      break;
    }

    const data = await parseJson<{
      data?: { listGoods?: Array<{ nmID: number; sizes?: Array<{ price: number; discountedPrice: number; discount: number }> }> };
    }>(res);

    const items = data.data?.listGoods ?? [];
    for (const item of items) {
      const size = item.sizes?.[0];
      if (size) {
        all.push({
          nmID: item.nmID,
          price: size.price,
          discount: size.discount,
          discountedPrice: size.discountedPrice,
        });
      }
    }

    if (items.length < PRICES_LIMIT) break;
    offset += PRICES_LIMIT;
    await sleep(PRICES_GAP_MS);
  }

  return all;
}

// ─── Statistics — rrdid pagination ────────────────────────────────────────────

export async function fetchReport(
  apiKey: string,
  dateFrom: string,
  dateTo: string,
): Promise<{ rows: WbStatRow[]; warning?: string }> {
  const h = hdrs(apiKey);
  const all: WbStatRow[] = [];
  let rrdid = 0;
  let pages = 0;

  for (;;) {
    const url = new URL(`${STATS_BASE}/api/v5/supplier/reportDetailByPeriod`);
    url.searchParams.set("dateFrom", dateFrom);
    url.searchParams.set("dateTo", dateTo);
    url.searchParams.set("limit", String(STATS_LIMIT));
    url.searchParams.set("rrdid", String(rrdid));

    const res = await apiFetch(
      url.toString(),
      { method: "GET", headers: h },
      { label: `wb:reportDetailByPeriod rrdid=${rrdid}`, timeoutMs: 60_000 },
    );

    if (!res.ok) {
      const text = await res.text();
      console.warn(`[wb:report] ${res.status}: ${text.slice(0, 200)}`);
      return {
        rows: all,
        warning: `WB статистика недоступна (${res.status}): ${text.slice(0, 200)}`,
      };
    }

    const rows = await parseJson<WbStatRow[]>(res);
    if (!Array.isArray(rows) || rows.length === 0) break;

    all.push(...rows);
    pages++;

    if (rows.length < STATS_LIMIT) break;

    if (pages >= STATS_MAX_PAGES) {
      console.warn("[wb:report] Safety cap reached — stopping after 3 pages");
      break;
    }

    rrdid = rows[rows.length - 1].rrd_id;
    await sleep(STATS_GAP_MS);
  }

  return { rows: all };
}
