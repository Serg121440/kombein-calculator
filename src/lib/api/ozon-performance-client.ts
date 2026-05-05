"use client";

/**
 * Client-side Ozon Performance API access.
 * Browsers in Russia can reach performance.ozon.ru directly, bypassing
 * the geo-block that affects Vercel's servers. CORS may still block it
 * — we surface the actual error so the user knows what happened.
 */

const PERF_BASE = "https://performance.ozon.ru";

export interface PerfDayStat {
  date: string;
  campaignId: string;
  campaignName: string;
  charge: number;
}

export interface PerfResult {
  stats: PerfDayStat[];
  warning?: string;
  error?: string;
}

function extractCharge(r: Record<string, unknown>): number {
  for (const key of ["charge", "moneySpent", "spent", "sum", "cost", "expenses", "totalCharge", "spend"]) {
    const v = r[key];
    const n = Number(v);
    if (v !== undefined && v !== null && v !== "" && Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

function extractDate(r: Record<string, unknown>, fallback: string): string {
  return String(r["date"] ?? r["eventDate"] ?? r["day"] ?? fallback).slice(0, 10);
}

function extractCampaignId(r: Record<string, unknown>): string {
  return String(r["campaignId"] ?? r["campaign_id"] ?? r["id"] ?? "");
}

async function fetchToken(clientId: string, clientSecret: string): Promise<string> {
  const res = await fetch(`${PERF_BASE}/api/client/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials",
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Токен ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) throw new Error("Нет access_token в ответе Performance API");
  return data.access_token;
}

async function fetchCampaigns(token: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const path of ["/api/client/campaign", "/api/client/campaigns", "/api/client/campaign/list"]) {
    try {
      const res = await fetch(`${PERF_BASE}${path}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) continue;
      const data = (await res.json()) as { list?: Array<{ id: string; title: string }>; campaigns?: Array<{ id: string; title: string }>; items?: Array<{ id: string; title: string }> };
      const list = data.list ?? data.campaigns ?? data.items ?? [];
      for (const c of list) map.set(c.id, c.title);
      if (map.size > 0) return map;
    } catch {
      continue;
    }
  }
  return map;
}

async function fetchStatsRows(
  token: string,
  dateFrom: string,
  dateTo: string,
): Promise<Record<string, unknown>[]> {
  const attempts: Array<{ url: string; init: RequestInit }> = [
    {
      url: `${PERF_BASE}/api/client/statistics/daily?dateFrom=${dateFrom}&dateTo=${dateTo}`,
      init: { method: "GET" },
    },
    {
      url: `${PERF_BASE}/api/client/statistics`,
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dateFrom, dateTo, groupBy: "DATE" }),
      },
    },
    {
      url: `${PERF_BASE}/api/client/statistics/json`,
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dateFrom, dateTo }),
      },
    },
  ];

  for (const a of attempts) {
    try {
      const init: RequestInit = {
        ...a.init,
        headers: { ...(a.init.headers ?? {}), Authorization: `Bearer ${token}` },
      };
      const res = await fetch(a.url, init);
      if (!res.ok) continue;
      const raw = (await res.json()) as Record<string, unknown>;
      for (const key of ["rows", "items", "data", "list", "statistics", "stats", "result"]) {
        if (Array.isArray(raw[key])) return raw[key] as Record<string, unknown>[];
      }
      if (Array.isArray(raw)) return raw as Record<string, unknown>[];
    } catch {
      continue;
    }
  }
  return [];
}

export async function fetchAdvertisingStatsClient(
  clientId: string,
  clientSecret: string,
  dateFrom: string,
  dateTo: string,
): Promise<PerfResult> {
  try {
    const token = await fetchToken(clientId, clientSecret);
    const nameMap = await fetchCampaigns(token);
    const rows = await fetchStatsRows(token, dateFrom, dateTo);

    const stats: PerfDayStat[] = rows
      .map((r) => {
        const cid = extractCampaignId(r);
        return {
          date: extractDate(r, dateFrom),
          campaignId: cid,
          campaignName: nameMap.get(cid) ?? cid,
          charge: extractCharge(r),
        };
      })
      .filter((s) => s.date >= dateFrom && s.date <= dateTo && s.charge > 0);

    if (stats.length === 0) {
      return { stats: [], warning: "Performance API: расходов за последние 30 дней не найдено" };
    }
    return { stats };
  } catch (err) {
    const msg = (err as Error).message;
    // CORS errors from the browser typically surface as "Failed to fetch" or "TypeError"
    if (msg.includes("Failed to fetch") || msg.toLowerCase().includes("cors") || msg === "TypeError") {
      return {
        stats: [],
        error: `CORS блокирует прямой запрос к performance.ozon.ru из браузера. Браузер не может прочесть ответ Ozon API. Решение — серверный прокси в РФ. Деталь: ${msg}`,
      };
    }
    return { stats: [], error: msg };
  }
}
