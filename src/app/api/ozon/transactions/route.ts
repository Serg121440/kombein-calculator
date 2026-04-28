import { NextRequest, NextResponse } from "next/server";

const BASE = "https://api-seller.ozon.ru";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { apiKey, clientId, fromDate, toDate } = body as {
      apiKey: string;
      clientId: string;
      fromDate?: string;
      toDate?: string;
    };

    if (!apiKey || !clientId) {
      return NextResponse.json(
        { error: "apiKey and clientId are required" },
        { status: 400 },
      );
    }

    const now = new Date();
    const monthAgo = new Date(now.getTime() - 30 * 86400 * 1000);
    const from = fromDate ?? monthAgo.toISOString();
    const to = toDate ?? now.toISOString();

    const hdrs = {
      "Client-Id": clientId,
      "Api-Key": apiKey,
      "Content-Type": "application/json",
    };

    const reqBody = {
      filter: {
        date: { from, to },
        operation_type: [],
        posting_number: "",
        transaction_type: "all",
      },
      page: 1,
      page_size: 1000,
    };

    const res = await fetch(`${BASE}/v3/finance/transaction/list`, {
      method: "POST",
      headers: hdrs,
      body: JSON.stringify(reqBody),
    });

    const text = await res.text();

    if (!res.ok) {
      // Return empty operations instead of error — products sync should still succeed
      console.error(`[ozon/transactions] ${res.status}:`, text);
      return NextResponse.json(
        {
          operations: [],
          warning: `Транзакции недоступны (${res.status}): ${text.slice(0, 200)}`,
        },
      );
    }

    let data: { result?: { operations?: unknown[] } };
    try {
      data = JSON.parse(text);
    } catch {
      return NextResponse.json({ operations: [], warning: "Ozon вернул не-JSON ответ" });
    }

    return NextResponse.json({ operations: data.result?.operations ?? [] });
  } catch (err) {
    console.error("[ozon/transactions] exception:", err);
    return NextResponse.json(
      { operations: [], warning: (err as Error).message },
    );
  }
}
