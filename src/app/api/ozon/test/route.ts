import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 30;

export async function POST(req: NextRequest) {
  try {
    const { apiKey, clientId } = (await req.json()) as {
      apiKey: string;
      clientId: string;
    };

    if (!apiKey || !clientId)
      return NextResponse.json({ error: "apiKey and clientId required" }, { status: 400 });

    const results: Record<string, unknown> = {};

    // Test 1: product/list
    try {
      const r1 = await fetch("https://api-seller.ozon.ru/v3/product/list", {
        method: "POST",
        headers: {
          "Client-Id": clientId,
          "Api-Key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ filter: { visibility: "ALL" }, last_id: "", limit: 1 }),
        signal: AbortSignal.timeout(15_000),
      });
      const body1 = await r1.text();
      results.products = { status: r1.status, body: tryJson(body1) };
    } catch (e) {
      results.products = { error: (e as Error).message };
    }

    // Test 2: seller info (simpler endpoint to check auth)
    try {
      const r2 = await fetch("https://api-seller.ozon.ru/v1/user/info", {
        method: "GET",
        headers: { "Client-Id": clientId, "Api-Key": apiKey },
        signal: AbortSignal.timeout(10_000),
      });
      const body2 = await r2.text();
      results.userInfo = { status: r2.status, body: tryJson(body2) };
    } catch (e) {
      results.userInfo = { error: (e as Error).message };
    }

    // Test 3: finance/transaction/list
    try {
      const now = new Date();
      const from = new Date(now.getTime() - 7 * 86400 * 1000).toISOString();
      const r3 = await fetch("https://api-seller.ozon.ru/v3/finance/transaction/list", {
        method: "POST",
        headers: {
          "Client-Id": clientId,
          "Api-Key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          filter: { date: { from, to: now.toISOString() }, operation_type: [], posting_number: "", transaction_type: "all" },
          page: 1,
          page_size: 1,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      const body3 = await r3.text();
      results.transactions = { status: r3.status, body: tryJson(body3) };
    } catch (e) {
      results.transactions = { error: (e as Error).message };
    }

    return NextResponse.json(results);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

function tryJson(s: string): unknown {
  try { return JSON.parse(s); } catch { return s.slice(0, 500); }
}
