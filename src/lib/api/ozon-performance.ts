/**
 * Ozon Performance API client (advertising expenses).
 * Docs: https://docs.ozon.ru/api/performance/
 *
 * Auth: separate credentials (client_id + client_secret) from
 * Ozon Seller → Настройки → API-ключи → сервисный аккаунт.
 * New host since 2025-01-15: api-performance.ozon.ru
 */

import { apiFetch, parseJson } from "./http";

const PERF_BASE = "https://api-performance.ozon.ru";

// ─── Auth ─────────────────────────────────────────────────────────────────────

async function fetchToken(clientId: string, clientSecret: string): Promise<string> {
  const res = await apiFetch(
    `${PERF_BASE}/api/client/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, grant_type: "client_credentials" }),
    },
    { label: "ozon-perf:token", timeoutMs: 30_000, maxRetries: 1 },
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Performance API token: ${res.status} ${text.slice(0, 200)}`);
  }

  const data = await parseJson<{ access_token: string }>(res);
  if (!data.access_token) throw new Error("Performance API: нет access_token в ответе");
  return data.access_token;
}

function perfHdrs(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

// ─── Campaign list ────────────────────────────────────────────────────────────

interface Campaign {
  id: string;
  title: string;
  state: string;
}

async function fetchCampaigns(token: string): Promise<Campaign[]> {
  try {
    const res = await apiFetch(
      `${PERF_BASE}/api/client/campaign`,
      { method: "GET", headers: perfHdrs(token) },
      { label: "ozon-perf:campaigns", maxRetries: 0 },
    );
    if (!res.ok) return [];
    const data = await res.json() as { list?: Campaign[]; campaigns?: Campaign[]; items?: Campaign[] };
    return data.list ?? data.campaigns ?? data.items ?? [];
  } catch {
    return [];
  }
}

// ─── Statistics ───────────────────────────────────────────────────────────────

export interface PerfDayStat {
  date: string;
  campaignId: string;
  campaignName: string;
  charge: number;
  orders: number;
}

function extractCharge(r: Record<string, unknown>): number {
  for (const key of ["charge", "moneySpent", "spent", "sum", "cost", "expenses", "totalCharge", "spend"]) {
    const n = Number(r[key]);
    if (r[key] != null && r[key] !== "" && Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

function extractDate(r: Record<string, unknown>, fallback: string): string {
  return String(r["date"] ?? r["eventDate"] ?? r["day"] ?? fallback).slice(0, 10);
}

function extractCampaignId(r: Record<string, unknown>): string {
  return String(r["campaignId"] ?? r["campaign_id"] ?? r["id"] ?? "");
}

function rowsFromResponse(raw: unknown): Record<string, unknown>[] {
  if (Array.isArray(raw)) return raw as Record<string, unknown>[];
  if (raw && typeof raw === "object") {
    for (const key of ["rows", "items", "data", "list", "statistics", "stats", "result"]) {
      const v = (raw as Record<string, unknown>)[key];
      if (Array.isArray(v)) return v as Record<string, unknown>[];
    }
  }
  return [];
}

function parseStatRows(rows: Record<string, unknown>[], dateFrom: string, dateTo: string): PerfDayStat[] {
  return rows
    .map((r) => ({
      date: extractDate(r, dateFrom),
      campaignId: extractCampaignId(r),
      campaignName: "",
      charge: extractCharge(r),
      orders: Number(r["orders"] ?? r["orderCount"] ?? 0),
    }))
    .filter((s) => s.date >= dateFrom && s.date <= dateTo && s.charge > 0);
}

async function pollReport(
  token: string,
  uuid: string,
  dateFrom: string,
  dateTo: string,
): Promise<PerfDayStat[]> {
  // Poll up to 15 times with 2s delay = 30s max wait
  for (let i = 0; i < 15; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    try {
      const res = await apiFetch(
        `${PERF_BASE}/api/client/statistics/report?UUID=${uuid}`,
        { method: "GET", headers: perfHdrs(token) },
        { label: "ozon-perf:report/poll", timeoutMs: 15_000, maxRetries: 0 },
      );
      if (!res.ok) {
        console.log(`[ozon-perf] poll ${uuid} status=${res.status}`);
        continue;
      }
      const raw = await res.json() as unknown;
      const status = raw && typeof raw === "object" ? (raw as Record<string, unknown>)["status"] : undefined;
      console.log(`[ozon-perf] poll ${uuid} attempt=${i + 1} status=${status} keys=${raw && typeof raw === "object" ? Object.keys(raw as object).join(",") : typeof raw}`);

      if (status === "IN_PROGRESS") continue;
      const rows = rowsFromResponse(raw);
      if (rows.length > 0) return parseStatRows(rows, dateFrom, dateTo);
      if (status === "OK") return [];
    } catch (e) {
      console.log(`[ozon-perf] poll ${uuid} attempt=${i + 1} error=${(e as Error).message}`);
      continue;
    }
  }
  console.log(`[ozon-perf] poll ${uuid} timed out after 30s`);
  return [];
}

const CAMPAIGN_BATCH = 10;

async function fetchStats(
  token: string,
  campaignIds: string[],
  dateFrom: string,
  dateTo: string,
): Promise<{ stats: PerfDayStat[]; warning?: string }> {
  // 1. Try sync daily endpoint (no campaign filter — returns all)
  try {
    const res = await apiFetch(
      `${PERF_BASE}/api/client/statistics/daily?dateFrom=${dateFrom}&dateTo=${dateTo}`,
      { method: "GET", headers: perfHdrs(token) },
      { label: "ozon-perf:statistics/daily", timeoutMs: 30_000, maxRetries: 0 },
    );
    if (res.ok) {
      const raw = await res.json() as unknown;
      const rows = rowsFromResponse(raw);
      const stats = rows.length > 0 ? parseStatRows(rows, dateFrom, dateTo) : [];
      console.log(`[ozon-perf] daily sync: rows=${rows.length} stats=${stats.length} raw=${JSON.stringify(raw).slice(0, 150)}`);
      if (stats.length > 0) return { stats };
    }
  } catch (e) {
    console.log(`[ozon-perf] daily sync error: ${(e as Error).message}`);
  }

  // 2. Async generate → poll, batching 10 campaigns at a time (API limit)
  const allStats: PerfDayStat[] = [];
  const batches: string[][] = [];
  for (let i = 0; i < campaignIds.length; i += CAMPAIGN_BATCH) {
    batches.push(campaignIds.slice(i, i + CAMPAIGN_BATCH));
  }
  // Also try with empty array (some accounts return all data without filter)
  if (batches.length === 0) batches.push([]);

  for (const batch of batches.slice(0, 5)) { // limit to first 50 campaigns to avoid timeouts
    try {
      const res = await apiFetch(
        `${PERF_BASE}/api/client/statistic/orders/generate`,
        { method: "POST", headers: perfHdrs(token), body: JSON.stringify({ campaigns: batch, dateFrom, dateTo }) },
        { label: "ozon-perf:generate", timeoutMs: 30_000, maxRetries: 0 },
      );
      if (!res.ok) {
        console.log(`[ozon-perf] generate batch=${batch.length} status=${res.status}`);
        continue;
      }
      const data = await res.json() as { UUID?: string };
      console.log(`[ozon-perf] generate batch=${batch.length} UUID=${data.UUID}`);
      if (!data.UUID) continue;
      const stats = await pollReport(token, data.UUID, dateFrom, dateTo);
      allStats.push(...stats);
      if (allStats.length > 0) break; // got data from first batch — enough
    } catch (e) {
      console.log(`[ozon-perf] generate error: ${(e as Error).message}`);
    }
  }

  if (allStats.length > 0) return { stats: allStats };
  return { stats: [], warning: "Performance API: нет данных о рекламных расходах за период" };
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
