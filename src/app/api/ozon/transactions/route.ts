import { NextRequest, NextResponse } from "next/server";

const OZON_BASE = "https://api-seller.ozon.ru";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { apiKey, clientId, fromDate, toDate } = body as {
      apiKey: string;
      clientId: string;
      fromDate: string;
      toDate: string;
    };

    if (!apiKey || !clientId) {
      return NextResponse.json(
        { error: "apiKey and clientId are required" },
        { status: 400 },
      );
    }

    const from = fromDate ?? new Date(Date.now() - 30 * 86400 * 1000).toISOString().slice(0, 10);
    const to = toDate ?? new Date().toISOString().slice(0, 10);

    const res = await fetch(`${OZON_BASE}/v3/finance/transaction/list`, {
      method: "POST",
      headers: {
        "Client-Id": clientId,
        "Api-Key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        filter: {
          date: { from: `${from}T00:00:00.000Z`, to: `${to}T23:59:59.999Z` },
          operation_type: [],
          posting_number: "",
          transaction_type: "all",
        },
        page: 1,
        page_size: 1000,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json(
        { error: `Ozon API error ${res.status}: ${text}` },
        { status: res.status },
      );
    }

    const data = (await res.json()) as {
      result: {
        operations: Array<{
          operation_id: number;
          operation_type: string;
          operation_type_name: string;
          operation_date: string;
          posting: {
            posting_number: string;
            order_date: string;
            items: Array<{ sku: number; name: string; quantity: number }>;
          };
          amount: number;
          type: string;
        }>;
      };
    };

    return NextResponse.json({ operations: data.result?.operations ?? [] });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
