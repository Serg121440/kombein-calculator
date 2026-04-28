/**
 * Wildberries API client (server-only).
 *
 * Limits (per WB docs):
 *   - General: 300 req / 60 s = 5 req/s
 *   - Content category: 100 req / min → gap ≥ 700 ms between pages
 *   - Statistics: very restrictive (~1 req / 3 min for heavy reports)
 *     → we fetch max 3 pages and pause 3 s between them
 *   - 429 handling: respect X-Ratelimit-Retry header
 *
 * Auth: Authorization: Bearer <token>
 * Hosts:
 *   - Content  → https://content-api.wildberries.ru
 *   - Statistics → https://statistics-api.wildberries.ru
 */

import { apiFetch, parseJson } from "./http";

const CONTENT_BASE = "https://content-api.wildberries.ru";
const STATS_BASE = "https://statistics-api.wildberries.ru";

const CARDS_LIMIT = 100;      // max cards per WB request
const STATS_LIMIT = 100_000;  // max rows per stats request
const CONTENT_GAP_MS = 700;   // ~1.4 req/s — well within 100/min limit
const STATS_GAP_MS = 3_000;   // conservative for heavy stats endpoint
const STATS_MAX_PAGES = 3;    // safety cap — 300k rows is plenty

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
  salePriceU?: number;
  dimensions?: {
    length: number;
    width: number;
    height: number;
    weightGross: number;
  };
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

// WB Content v2 response wraps cards inside data.cards
interface CardsApiResponse {
  data?: {
    cards: WbCard[];
    cursor: { updatedAt: string; nmID: number; total: number };
  };
  // Older API format: top-level cards array (fallback)
  cards?: WbCard[];
  error?: boolean;
  errorText?: string;
}

// ─── Products — cursor pagination ─────────────────────────────────────────────

export async function fetchAllCards(
  apiKey: string,
): Promise<WbCard[]> {
  const h = hdrs(apiKey);
  const all: WbCard[] = [];
  let cursor: { updatedAt?: string; nmID?: number } = {};

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

    // Support both response shapes
    const cards: WbCard[] = data.data?.cards ?? data.cards ?? [];
    all.push(...cards);

    if (cards.length < CARDS_LIMIT) break;

    const next = data.data?.cursor;
    if (!next?.updatedAt) break;
    cursor = { updatedAt: next.updatedAt, nmID: next.nmID };
    await sleep(CONTENT_GAP_MS);
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

    // Continue from the last rrd_id
    rrdid = rows[rows.length - 1].rrd_id;
    await sleep(STATS_GAP_MS);
  }

  return { rows: all };
}
