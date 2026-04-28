import { NextRequest, NextResponse } from "next/server";
import { fetchReport } from "@/lib/api/wb";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const { apiKey, fromDate } = (await req.json()) as {
      apiKey: string;
      fromDate?: string;
    };

    if (!apiKey) {
      return NextResponse.json({ error: "apiKey is required" }, { status: 400 });
    }

    const dateTo = new Date().toISOString().slice(0, 10);
    const dateFrom =
      fromDate ??
      new Date(Date.now() - 30 * 86_400 * 1_000).toISOString().slice(0, 10);

    const result = await fetchReport(apiKey, dateFrom, dateTo);
    return NextResponse.json(result);
  } catch (err) {
    const msg = (err as Error).message;
    console.error("[wb/transactions]", msg);
    return NextResponse.json({ rows: [], warning: msg });
  }
}
