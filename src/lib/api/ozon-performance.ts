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

async function fetchToken(clientId: string, clientSecret: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);

  // Try both body formats; form-encoded is RFC 6749 standard, JSON is Ozon's documented format.
  // Let Node.js follow redirects automatically so anti-bot cookies are preserved between hops.
  const attempts: Array<{ contentType: string; body: string }> = [
    {
      contentType: "application/x-www-form-urlencoded",
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: "client_credentials" }).toString(),
    },
    {
      contentType: "application/json",
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, grant_type: "client_credentials" }),
    },
  ];

  let lastError = "";
  for (const attempt of attempts) {
    try {
      const res = await fetch(`${PERF_BASE}/api/client/token`, {
        method: "POST",
        headers: { "Content-Type": attempt.contentType, Accept: "application/json" },
        body: attempt.body,
        redirect: "follow",
        signal: controller.signal,
      });

      if (res.ok) {
        const data = await parseJson<{ access_token: string }>(res);
        if (data.access_token) {
          clearTimeout(timer);
          return data.access_token;
        }
      }

      const text = await res.text().catch(() => "");
      const isHtml = text.trim().startsWith("<");
      lastError = `${res.status} ${isHtml ? "(HTML — антибот)" : text.slice(0, 150)}`;
    } catch (e) {
      const err = e as Error & { cause?: { code?: string; message?: string }; code?: string };
      const causeCode = err.cause?.code ?? err.code ?? "";
      const causeMsg = err.cause?.message ?? "";
      lastError = `${err.message}${causeCode ? ` [${causeCode}]` : ""}${causeMsg && causeMsg !== err.message ? ` (${causeMsg})` : ""}`;
    }
  }

  clearTimeout(timer);
  throw new Error(`Performance API: не удалось получить токен. ${lastError}`);
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
  const paths = [
    "/api/client/campaign",
    "/api/client/campaigns",
    "/api/client/campaign/list",
  ];
  for (const path of paths) {
    try {
      const res = await apiFetch(
        `${PERF_BASE}${path}`,
        { method: "GET", headers: perfHdrs(token) },
        { label: `ozon-perf:campaign${path}`, maxRetries: 0 },
      );
      if (!res.ok) continue;
      const data = await res.json() as { list?: Campaign[]; campaigns?: Campaign[]; items?: Campaign[] };
      const list = data.list ?? data.campaigns ?? data.items ?? [];
      if (Array.isArray(list)) return list;
    } catch {
      continue;
    }
  }
  return [];
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

  // Even with 0 campaigns (endpoint 404 or empty account), try fetching stats —
  // some statistics endpoints don't require campaign IDs.
  const activeCampaignIds = campaigns
    .filter((c) => c.state !== "ARCHIVED" && c.state !== "STOPPED")
    .map((c) => c.id);
  const campaignIds = activeCampaignIds.length > 0 ? activeCampaignIds : campaigns.map((c) => c.id);

  const result = await fetchStats(token, campaignIds, dateFrom, dateTo);

  const nameMap = new Map(campaigns.map((c) => [c.id, c.title]));
  for (const s of result.stats) {
    s.campaignName = nameMap.get(s.campaignId) ?? s.campaignId;
  }

  console.log(`[ozon-perf] campaigns=${campaigns.length} active=${campaignIds.length} stats=${result.stats.length}`);
  if (result.warning) console.warn("[ozon-perf]", result.warning);

  return { stats: result.stats, warning: result.warning };
}
