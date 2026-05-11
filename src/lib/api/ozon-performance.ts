/**
 * Ozon Performance API client (advertising expenses).
 * Docs: https://docs.ozon.ru/api/performance/
 *
 * Auth: separate credentials (client_id + client_secret) from
 * Ozon Seller → Настройки → API-ключи → сервисный аккаунт.
 * Host since 2025-01-15: api-performance.ozon.ru
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
    const data = await res.json() as { list?: Campaign[] };
    return data.list ?? [];
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

function campaignIdsQuery(ids: string[]): string {
  return ids.map((id) => `campaignIds=${encodeURIComponent(id)}`).join("&");
}

function parsePerfCsv(text: string, dateFrom: string, dateTo: string, fallbackCampaignId: string): PerfDayStat[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() && !l.startsWith(";"));
  if (lines.length < 2) return [];

  const headers = lines[0].split(";").map((h) => h.trim().toLowerCase());
  const dateIdx = headers.findIndex((h) => h.includes("дата") || h === "date");
  const chargeIdx = headers.findIndex((h) =>
    h.includes("расход") || h.includes("charge") || h.includes("spent") || h.includes("стоимость"),
  );
  const ordersIdx = headers.findIndex((h) => h.includes("заказ") || h === "orders");
  const nameIdx = headers.findIndex((h) => h.includes("кампани") || h.includes("название") || h === "name");
  const idIdx = headers.findIndex((h) => h === "id" || h === "campaign_id");

  console.log(`[ozon-perf] csv headers=${headers.join("|")} chargeIdx=${chargeIdx} dateIdx=${dateIdx}`);

  const stats: PerfDayStat[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(";").map((c) => c.trim().replace(/,/g, "."));
    const rawDate = dateIdx >= 0 ? (cols[dateIdx] ?? "") : "";
    // Dates may be DD.MM.YYYY — convert to YYYY-MM-DD
    const date = rawDate.includes(".")
      ? rawDate.split(".").reverse().join("-").slice(0, 10)
      : rawDate.slice(0, 10);
    const chargeRaw = chargeIdx >= 0 ? parseFloat(cols[chargeIdx] ?? "0") : 0;
    const cid = idIdx >= 0 ? (cols[idIdx] ?? fallbackCampaignId) : fallbackCampaignId;
    const name = nameIdx >= 0 ? (cols[nameIdx] ?? "") : "";
    const orders = ordersIdx >= 0 ? parseInt(cols[ordersIdx] ?? "0", 10) : 0;

    if (chargeRaw > 0 && (!date || (date >= dateFrom && date <= dateTo))) {
      stats.push({ date: date || dateFrom, campaignId: cid, campaignName: name, charge: chargeRaw, orders });
    }
  }
  return stats;
}

// ─── Async report: generate → poll status → download ─────────────────────────

async function generateReport(
  token: string,
  campaignIds: string[],
  dateFrom: string,
  dateTo: string,
): Promise<string | null> {
  try {
    const res = await apiFetch(
      `${PERF_BASE}/api/client/statistics`,
      {
        method: "POST",
        headers: perfHdrs(token),
        body: JSON.stringify({ campaigns: campaignIds, dateFrom, dateTo, groupBy: "DATE" }),
      },
      { label: "ozon-perf:statistics/generate", timeoutMs: 30_000, maxRetries: 0 },
    );
    if (!res.ok) {
      console.log(`[ozon-perf] generate http=${res.status}`);
      return null;
    }
    const data = await res.json() as { UUID?: string };
    console.log(`[ozon-perf] generate UUID=${data.UUID}`);
    return data.UUID ?? null;
  } catch (e) {
    console.log(`[ozon-perf] generate error: ${(e as Error).message}`);
    return null;
  }
}

async function pollAndDownload(
  token: string,
  uuid: string,
  dateFrom: string,
  dateTo: string,
  batchCampaignId: string,
): Promise<PerfDayStat[]> {
  // Step 1: Poll GET /api/client/statistics/{UUID} for status + link
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    try {
      const statusRes = await apiFetch(
        `${PERF_BASE}/api/client/statistics/${uuid}`,
        { method: "GET", headers: perfHdrs(token) },
        { label: "ozon-perf:status", timeoutMs: 15_000, maxRetries: 0 },
      );
      if (!statusRes.ok) {
        console.log(`[ozon-perf] status ${uuid} http=${statusRes.status}`);
        continue;
      }
      const status = await statusRes.json() as { state?: string; link?: string; error?: string };
      console.log(`[ozon-perf] status ${uuid} attempt=${i + 1} state=${status.state} link=${status.link}`);

      if (status.state === "IN_PROGRESS" || status.state === "NOT_STARTED") continue;
      if (status.state === "ERROR") {
        console.log(`[ozon-perf] report error: ${status.error}`);
        return [];
      }
      if (status.state !== "OK") continue;

      // Step 2: Download report
      const downloadUrl = status.link
        ? (status.link.startsWith("http") ? status.link : `${PERF_BASE}${status.link}`)
        : `${PERF_BASE}/api/client/statistics/report?UUID=${uuid}`;

      const dlRes = await apiFetch(
        downloadUrl,
        { method: "GET", headers: { Authorization: `Bearer ${token}` } },
        { label: "ozon-perf:download", timeoutMs: 30_000, maxRetries: 0 },
      );
      if (!dlRes.ok) {
        console.log(`[ozon-perf] download http=${dlRes.status}`);
        return [];
      }
      const ct = dlRes.headers.get("content-type") ?? "";
      console.log(`[ozon-perf] download ct=${ct}`);

      if (ct.includes("zip")) {
        // ZIP with multiple CSV files — we'd need a zip parser; skip for now
        console.log(`[ozon-perf] ZIP response — skipping (need single-campaign batches)`);
        return [];
      }

      const text = await dlRes.text();
      return parsePerfCsv(text, dateFrom, dateTo, batchCampaignId);
    } catch (e) {
      console.log(`[ozon-perf] poll ${uuid} attempt=${i + 1} error=${(e as Error).message}`);
    }
  }
  console.log(`[ozon-perf] poll ${uuid} timed out`);
  return [];
}

// ─── Main stats fetcher ───────────────────────────────────────────────────────

async function fetchStats(
  token: string,
  campaignIds: string[],
  dateFrom: string,
  dateTo: string,
): Promise<{ stats: PerfDayStat[]; warning?: string }> {
  const idQuery = campaignIdsQuery(campaignIds);

  // 1. Sync expense/json endpoint — daily spend per campaign, direct JSON response
  for (const path of [
    `/api/client/statistics/expense/json?${idQuery}&dateFrom=${dateFrom}&dateTo=${dateTo}`,
    `/api/client/statistics/daily/json?${idQuery}&dateFrom=${dateFrom}&dateTo=${dateTo}`,
  ]) {
    try {
      const res = await apiFetch(
        `${PERF_BASE}${path}`,
        { method: "GET", headers: perfHdrs(token) },
        { label: "ozon-perf:sync", timeoutMs: 30_000, maxRetries: 0 },
      );
      if (!res.ok) continue;
      const raw = await res.json() as unknown;
      // Response: { rows: [{ id, date, title, moneySpent, bonusSpent, ... }] }
      // or daily: { rows: [{ id, date, title, shows, clicks, expense, orders }] }
      const rows = Array.isArray(raw) ? raw as Record<string, unknown>[]
        : raw && typeof raw === "object" ? (Object.values(raw as Record<string, unknown>).find(Array.isArray) as Record<string, unknown>[] ?? [])
        : [];
      if (rows.length > 0) {
        const stats: PerfDayStat[] = rows
          .map((r) => {
            // moneySpent uses Russian comma decimal ("37666,70")
            const parseRub = (v: unknown) => parseFloat(String(v ?? "0").replace(",", ".")) || 0;
            const charge = parseRub(r["moneySpent"]) || parseRub(r["expense"]) || parseRub(r["расход"]) || parseRub(r["charge"]);
            const rawDate = String(r["date"] ?? r["дата"] ?? dateFrom);
            const date = rawDate.includes(".") ? rawDate.split(".").reverse().join("-").slice(0, 10) : rawDate.slice(0, 10);
            return {
              date,
              campaignId: String(r["id"] ?? r["campaignId"] ?? ""),
              campaignName: String(r["title"] ?? r["campaignName"] ?? ""),
              charge,
              orders: Number(r["orders"] ?? r["заказы"] ?? 0),
            };
          })
          .filter((s) => s.charge > 0 && s.date >= dateFrom && s.date <= dateTo);
        if (stats.length > 0) return { stats };
      }
    } catch (e) {
      console.log(`[ozon-perf] sync error: ${(e as Error).message}`);
    }
  }

  // 2. Async: POST /api/client/statistics → poll status → download CSV
  // Send one campaign at a time to get CSV (not ZIP)
  const allStats: PerfDayStat[] = [];
  for (const campaignId of campaignIds.slice(0, 10)) {
    const uuid = await generateReport(token, [campaignId], dateFrom, dateTo);
    if (!uuid) continue;
    const stats = await pollAndDownload(token, uuid, dateFrom, dateTo, campaignId);
    allStats.push(...stats);
    if (allStats.length > 0) break; // enough for now — confirm it works first
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
    .filter((c) => c.state !== "CAMPAIGN_STATE_ARCHIVED" && c.state !== "CAMPAIGN_STATE_INACTIVE")
    .map((c) => c.id);
  const campaignIds = activeCampaignIds.length > 0 ? activeCampaignIds : campaigns.map((c) => c.id);

  const result = await fetchStats(token, campaignIds, dateFrom, dateTo);

  const nameMap = new Map(campaigns.map((c) => [c.id, c.title]));
  for (const s of result.stats) {
    if (!s.campaignName) s.campaignName = nameMap.get(s.campaignId) ?? s.campaignId;
  }

  console.log(`[ozon-perf] campaigns=${campaigns.length} active=${campaignIds.length} stats=${result.stats.length}`);
  if (result.warning) console.warn("[ozon-perf]", result.warning);

  return { stats: result.stats, warning: result.warning };
}
