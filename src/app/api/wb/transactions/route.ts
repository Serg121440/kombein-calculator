import { NextRequest, NextResponse } from "next/server";

const WB_STATS_BASE = "https://statistics-api.wildberries.ru";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { apiKey, fromDate } = body as {
      apiKey: string;
      fromDate?: string;
    };

    if (!apiKey) {
      return NextResponse.json(
        { error: "apiKey is required" },
        { status: 400 },
      );
    }

    const from =
      fromDate ?? new Date(Date.now() - 30 * 86400 * 1000).toISOString().slice(0, 10);

    const res = await fetch(
      `${WB_STATS_BASE}/api/v5/supplier/reportDetailByPeriod?dateFrom=${from}&dateTo=${new Date().toISOString().slice(0, 10)}&limit=100000&rrdid=0`,
      {
        headers: { Authorization: apiKey },
      },
    );

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json(
        { error: `WB Stats API error ${res.status}: ${text}` },
        { status: res.status },
      );
    }

    const data = await res.json();
    return NextResponse.json({ rows: data ?? [] });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
