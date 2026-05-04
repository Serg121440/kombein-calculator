/**
 * Ozon Performance API client (advertising expenses).
 * Docs: https://docs.ozon.ru/api/performance/
 *
 * Auth: separate OAuth2 credentials (client_id + client_secret),
 * distinct from the Seller API key. Obtain in:
 * Ozon Seller → Реклама → Продвижение → API
 *
 * Token expires in 1 hour — we re-fetch per sync call (stateless).
 */

import { apiFetch, parseJson } from "./http";

const PERF_BASE = "https://performance.ozon.ru";

// ─── Auth ─────────────────────────────────────────────────────────────────────

async function fetchToken(clientId: string, clientSecret: string): Promise<string> {
  const res = await apiFetch(
    `${PERF_BASE}/api/client/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "client_credentials",
      }),
    },
    { label: "ozon-perf:token", maxRetries: 1 },
  );
  const data = await parseJson<{ access_token: string }>(res);
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
  const data = await parseJson<{ list: Campaign[] }>(res);
  return data.list ?? [];
}

// ─── Daily statistics ─────────────────────────────────────────────────────────

export interface PerfDayStat {
  date: string;
  campaignId: string;
  campaignName: string;
  /** Total advertising spend for the day, RUB */
  charge: number;
  /** Orders from advertising */
  orders: number;
  /** Revenue from orders from advertising */
  revenue: number;
}

interface RawStat {
  date: string;
  charge: number | string;
  orders: number | string;
  moneySpent?: number | string;
  ordersMoney?: number | string;
}

async function fetchCampaignStats(
  token: string,
  campaignIds: string[],
  dateFrom: string,
  dateTo: string,
): Promise<PerfDayStat[]> {
  if (campaignIds.length === 0) return [];

  const res = await apiFetch(
    `${PERF_BASE}/api/client/statistics/daily`,
    {
      method: "GET",
      headers: perfHdrs(token),
    },
    { label: "ozon-perf:statistics/daily", timeoutMs: 45_000 },
  );

  if (!res.ok) {
    // Endpoint might differ — try alternate
    return fetchCampaignStatsFallback(token, campaignIds, dateFrom, dateTo);
  }

  const data = await parseJson<{ rows: Array<RawStat & { campaignId?: string; campaign_id?: string }> }>(res);
  const rows = data.rows ?? [];

  return rows
    .filter((r) => {
      const d = r.date?.slice(0, 10);
      return d >= dateFrom && d <= dateTo;
    })
    .map((r) => ({
      date: r.date?.slice(0, 10) ?? dateFrom,
      campaignId: String(r.campaignId ?? r.campaign_id ?? ""),
      campaignName: "",
      charge: Number(r.charge ?? r.moneySpent ?? 0),
      orders: Number(r.orders ?? 0),
      revenue: Number(r.ordersMoney ?? 0),
    }));
}

async function fetchCampaignStatsFallback(
  token: string,
  campaignIds: string[],
  dateFrom: string,
  dateTo: string,
): Promise<PerfDayStat[]> {
  const res = await apiFetch(
    `${PERF_BASE}/api/client/statistics`,
    {
      method: "POST",
      headers: perfHdrs(token),
      body: JSON.stringify({
        campaigns: campaignIds,
        dateFrom,
        dateTo,
        groupBy: "DATE",
      }),
    },
    { label: "ozon-perf:statistics", timeoutMs: 45_000 },
  );
  const data = await parseJson<{ rows: Array<RawStat & { campaignId?: string }> }>(res);
  return (data.rows ?? []).map((r) => ({
    date: r.date?.slice(0, 10) ?? dateFrom,
    campaignId: String(r.campaignId ?? ""),
    campaignName: "",
    charge: Number(r.charge ?? r.moneySpent ?? 0),
    orders: Number(r.orders ?? 0),
    revenue: Number(r.ordersMoney ?? 0),
  }));
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
    .filter((c) => c.state !== "ARCHIVED")
    .map((c) => c.id);

  if (activeCampaignIds.length === 0) {
    return { stats: [], warning: "Нет активных рекламных кампаний" };
  }

  const stats = await fetchCampaignStats(token, activeCampaignIds, dateFrom, dateTo);

  // Enrich campaignName from the campaign list
  const nameMap = new Map(campaigns.map((c) => [c.id, c.title]));
  for (const s of stats) {
    s.campaignName = nameMap.get(s.campaignId) ?? s.campaignId;
  }

  return { stats };
}
