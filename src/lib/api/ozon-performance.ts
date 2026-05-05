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


function parsePerfCsv(text: string, dateFrom: string, dateTo: string, campaignId: string): PerfDayStat[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() && !l.startsWith(";"));
  if (lines.length < 2) return [];

  const headers = lines[0].split(";").map((h) => h.trim().toLowerCase());

  // Find relevant column indices
  const dateIdx = headers.findIndex((h) => h.includes("дата") || h === "date");
  const chargeIdx = headers.findIndex((h) =>
    h.includes("расход") || h.includes("charge") || h.includes("spent") || h.includes("стоимость"),
  );
  const ordersIdx = headers.findIndex((h) => h.includes("заказ") || h === "orders");
  const nameIdx = headers.findIndex((h) => h.includes("кампани") || h.includes("название") || h === "name");
  const idIdx = headers.findIndex((h) => h === "id" || h === "campaign_id");

  console.log(`[ozon-perf] csv headers: ${headers.join("|")} chargeIdx=${chargeIdx} dateIdx=${dateIdx}`);

  const stats: PerfDayStat[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(";").map((c) => c.trim().replace(/,/g, "."));
    const date = dateIdx >= 0 ? (cols[dateIdx] ?? "").slice(0, 10) : "";
    const chargeRaw = chargeIdx >= 0 ? parseFloat(cols[chargeIdx] ?? "0") : 0;
    const cid = idIdx >= 0 ? cols[idIdx] : campaignId;
    const name = nameIdx >= 0 ? cols[nameIdx] : "";
    const orders = ordersIdx >= 0 ? parseInt(cols[ordersIdx] ?? "0", 10) : 0;

    if (chargeRaw > 0 && (!date || (date >= dateFrom && date <= dateTo))) {
      stats.push({ date: date || dateFrom, campaignId: cid, campaignName: name, charge: chargeRaw, orders });
    }
  }
  return stats;
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

async function pollReport(
  token: string,
  uuid: string,
  campaignId: string,
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
        console.log(`[ozon-perf] poll ${uuid} http=${res.status}`);
        continue;
      }
      const ct = res.headers.get("content-type") ?? "";
      const text = await res.text();
      console.log(`[ozon-perf] poll ${uuid} attempt=${i + 1} ct=${ct} len=${text.length} preview=${text.slice(0, 80)}`);

      // CSV response → ready
      if (!ct.includes("json") || text.trim().startsWith("ID") || text.includes(";")) {
        return parsePerfCsv(text, dateFrom, dateTo, campaignId);
      }

      // JSON response → check status
      try {
        const raw = JSON.parse(text) as Record<string, unknown>;
        if (raw["status"] === "IN_PROGRESS") continue;
        if (raw["status"] === "OK") return [];
      } catch {
        // Not JSON, treat as CSV
        return parsePerfCsv(text, dateFrom, dateTo, campaignId);
      }
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
      const text = await res.text();
      console.log(`[ozon-perf] daily sync ct=${res.headers.get("content-type")} len=${text.length} preview=${text.slice(0, 80)}`);
      const stats = parsePerfCsv(text, dateFrom, dateTo, "");
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
  if (batches.length === 0) batches.push([]);

  for (const batch of batches.slice(0, 5)) { // first 50 campaigns max to avoid request timeout
    try {
      const res = await apiFetch(
        `${PERF_BASE}/api/client/statistic/orders/generate`,
        { method: "POST", headers: perfHdrs(token), body: JSON.stringify({ campaigns: batch, dateFrom, dateTo }) },
        { label: "ozon-perf:generate", timeoutMs: 30_000, maxRetries: 0 },
      );
      if (!res.ok) {
        console.log(`[ozon-perf] generate batch=${batch.length} http=${res.status}`);
        continue;
      }
      const data = await res.json() as { UUID?: string };
      console.log(`[ozon-perf] generate batch=${batch.length} UUID=${data.UUID}`);
      if (!data.UUID) continue;
      const batchCampaignId = batch[0] ?? "";
      const stats = await pollReport(token, data.UUID, batchCampaignId, dateFrom, dateTo);
      allStats.push(...stats);
      if (allStats.length > 0) break;
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
