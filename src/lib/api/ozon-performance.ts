/**
 * Ozon Performance API client (advertising expenses).
 * Docs: https://docs.ozon.ru/api/performance/#tag/Token
 *
 * Auth: separate OAuth2 credentials (client_id + client_secret),
 * distinct from the Seller API key. Obtain in:
 * Ozon Seller → Реклама → Продвижение → API
 */

import { apiFetch, parseJson } from "./http";

const PERF_BASE = "https://performance.ozon.ru";

// ─── Auth ─────────────────────────────────────────────────────────────────────

async function tokenPost(url: string, body: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    return await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      redirect: "manual",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchToken(clientId: string, clientSecret: string): Promise<string> {
  const body = JSON.stringify({ client_id: clientId, client_secret: clientSecret, grant_type: "client_credentials" });
  let res = await tokenPost(`${PERF_BASE}/api/client/token`, body);

  // Follow a single same-host redirect (Ozon adds ?__rr=1 on first request)
  if (res.status >= 300 && res.status < 400) {
    const location = res.headers.get("location") ?? "";
    if (location && location.startsWith(PERF_BASE)) {
      res = await tokenPost(location, body);
    } else {
      throw new Error(`Токен-эндпоинт редиректит за пределы домена: ${location || "(нет Location)"}`);
    }
  }

  const data = await parseJson<{ access_token: string }>(res);
  if (!data.access_token) throw new Error("Нет access_token в ответе Performance API");
  return data.access_token;
}

function perfHdrs(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "Client-Name": "kombein-calculator",
  };
}

// ─── Campaign list ────────────────────────────────────────────────────────────

interface Campaign {
  id: string;
  title: string;
  state: string;
}

async function fetchCampaigns(token: string): Promise<Campaign[]> {
  const res = await apiFetch(
    `${PERF_BASE}/api/client/campaign`,
    { method: "GET", headers: perfHdrs(token) },
    { label: "ozon-perf:campaigns" },
  );
  const data = await parseJson<{ list?: Campaign[]; campaigns?: Campaign[]; items?: Campaign[] }>(res);
  return data.list ?? data.campaigns ?? data.items ?? [];
}

// ─── Statistics: try multiple endpoint variants ───────────────────────────────

export interface PerfDayStat {
  date: string;
  campaignId: string;
  campaignName: string;
  /** Total advertising spend for the day, RUB */
  charge: number;
  orders: number;
}

/** Extract spend amount from a raw stat row — tries all known field names */
function extractCharge(r: Record<string, unknown>): number {
  const candidates = [
    r["charge"],
    r["moneySpent"],
    r["spent"],
    r["sum"],
    r["cost"],
    r["expenses"],
    r["totalCharge"],
    r["spend"],
    r["views"] !== undefined ? undefined : undefined, // not a spend field
  ];
  for (const v of candidates) {
    const n = Number(v);
    if (v !== undefined && v !== null && v !== "" && Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

function extractDate(r: Record<string, unknown>, fallback: string): string {
  const raw = String(r["date"] ?? r["eventDate"] ?? r["day"] ?? fallback);
  return raw.slice(0, 10);
}

function extractCampaignId(r: Record<string, unknown>): string {
  return String(r["campaignId"] ?? r["campaign_id"] ?? r["id"] ?? "");
}

async function tryStatEndpoint(
  token: string,
  url: string,
  init: RequestInit,
  label: string,
  dateFrom: string,
  dateTo: string,
): Promise<{ stats: PerfDayStat[]; rawDebug: unknown } | null> {
  try {
    const res = await apiFetch(url, { ...init, headers: perfHdrs(token) }, { label, timeoutMs: 45_000 });
    if (!res.ok) return null;
    const raw = await res.json() as Record<string, unknown>;

    // Find an array of stat rows anywhere in the response
    let rows: Record<string, unknown>[] = [];
    for (const key of ["rows", "items", "data", "list", "statistics", "stats", "result"]) {
      if (Array.isArray(raw[key])) {
        rows = raw[key] as Record<string, unknown>[];
        break;
      }
    }
    if (rows.length === 0 && Array.isArray(raw)) {
      rows = raw as Record<string, unknown>[];
    }

    const stats: PerfDayStat[] = rows
      .map((r) => ({
        date: extractDate(r, dateFrom),
        campaignId: extractCampaignId(r),
        campaignName: "",
        charge: extractCharge(r),
        orders: Number(r["orders"] ?? r["orderCount"] ?? 0),
      }))
      .filter((s) => s.date >= dateFrom && s.date <= dateTo && s.charge > 0);

    return { stats, rawDebug: raw };
  } catch {
    return null;
  }
}

async function fetchStats(
  token: string,
  campaignIds: string[],
  dateFrom: string,
  dateTo: string,
): Promise<{ stats: PerfDayStat[]; rawDebug?: unknown; warning?: string }> {
  const idList = campaignIds.join(",");

  // Try endpoints in order of likelihood
  const attempts = [
    // 1. Daily stats GET with date params
    {
      url: `${PERF_BASE}/api/client/statistics/daily?dateFrom=${dateFrom}&dateTo=${dateTo}`,
      init: { method: "GET" } as RequestInit,
      label: "ozon-perf:statistics/daily",
    },
    // 2. Statistics POST (report-style)
    {
      url: `${PERF_BASE}/api/client/statistics`,
      init: {
        method: "POST",
        body: JSON.stringify({ campaigns: campaignIds, dateFrom, dateTo, groupBy: "DATE" }),
      } as RequestInit,
      label: "ozon-perf:statistics",
    },
    // 3. Statistics with campaign ids in query
    {
      url: `${PERF_BASE}/api/client/statistics/daily?campaigns=${idList}&dateFrom=${dateFrom}&dateTo=${dateTo}`,
      init: { method: "GET" } as RequestInit,
      label: "ozon-perf:statistics/daily-ids",
    },
    // 4. JSON report endpoint
    {
      url: `${PERF_BASE}/api/client/statistics/json`,
      init: {
        method: "POST",
        body: JSON.stringify({ campaigns: campaignIds, dateFrom, dateTo }),
      } as RequestInit,
      label: "ozon-perf:statistics/json",
    },
  ];

  for (const a of attempts) {
    const result = await tryStatEndpoint(token, a.url, a.init, a.label, dateFrom, dateTo);
    if (result !== null) {
      if (result.stats.length > 0) return result;
      // Endpoint responded but no charge > 0 — return with debug
      return {
        stats: [],
        rawDebug: result.rawDebug,
        warning: `Performance API ответил, но нет расходов > 0. Ответ: ${JSON.stringify(result.rawDebug).slice(0, 300)}`,
      };
    }
  }

  return { stats: [], warning: "Все варианты endpoint'ов Performance API не ответили" };
}

// ─── Public entry point ───────────────────────────────────────────────────────

export async function fetchAdvertisingStats(
  clientId: string,
  clientSecret: string,
  dateFrom: string,
  dateTo: string,
): Promise<{ stats: PerfDayStat[]; warning?: string }> {
  const token = await fetchToken(clientId, clientSecret);
  const campaigns = await fetchCampaigns(token);

  if (campaigns.length === 0) {
    return { stats: [], warning: "Нет рекламных кампаний в аккаунте Performance" };
  }

  const activeCampaignIds = campaigns
    .filter((c) => c.state !== "ARCHIVED" && c.state !== "STOPPED")
    .map((c) => c.id);

  const campaignIds = activeCampaignIds.length > 0 ? activeCampaignIds : campaigns.map((c) => c.id);

  const result = await fetchStats(token, campaignIds, dateFrom, dateTo);

  // Enrich campaignName
  const nameMap = new Map(campaigns.map((c) => [c.id, c.title]));
  for (const s of result.stats) {
    s.campaignName = nameMap.get(s.campaignId) ?? s.campaignId;
  }

  console.log(`[ozon-perf] campaigns=${campaigns.length} active=${campaignIds.length} stats=${result.stats.length}`);
  if (result.warning) console.warn("[ozon-perf]", result.warning);

  return { stats: result.stats, warning: result.warning };
}
