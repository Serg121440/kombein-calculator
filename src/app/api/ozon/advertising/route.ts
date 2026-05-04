import { NextRequest, NextResponse } from "next/server";
import { fetchAdvertisingStats } from "@/lib/api/ozon-performance";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      perfClientId?: string;
      perfClientSecret?: string;
      dateFrom?: string;
      dateTo?: string;
    };
    const { perfClientId, perfClientSecret, dateFrom, dateTo } = body;

    if (!perfClientId || !perfClientSecret) {
      return NextResponse.json(
        { error: "perfClientId и perfClientSecret обязательны" },
        { status: 400 },
      );
    }

    const from = dateFrom ?? new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    const to = dateTo ?? new Date().toISOString().slice(0, 10);

    const result = await fetchAdvertisingStats(perfClientId, perfClientSecret, from, to);
    return NextResponse.json(result);
  } catch (err) {
    const e = err as Error & { cause?: unknown };
    const causeMsg = (e.cause as Error | undefined)?.message ?? "";
    const msg = e.message + (causeMsg && !e.message.includes(causeMsg) ? ` (${causeMsg})` : "");
    console.error("[ozon/advertising] error:", msg, e.cause ?? "");
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
