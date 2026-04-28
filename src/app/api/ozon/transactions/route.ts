import { NextRequest, NextResponse } from "next/server";
import { fetchTransactions } from "@/lib/api/ozon";

export async function POST(req: NextRequest) {
  try {
    const { apiKey, clientId, fromDate, toDate } = (await req.json()) as {
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
    const monthAgo = new Date(now.getTime() - 30 * 86_400 * 1_000);
    const from = fromDate ?? monthAgo.toISOString();
    const to = toDate ?? now.toISOString();

    const result = await fetchTransactions(apiKey, clientId, from, to);
    return NextResponse.json(result);
  } catch (err) {
    const msg = (err as Error).message;
    console.error("[ozon/transactions]", msg);
    return NextResponse.json({ operations: [], warning: msg });
  }
}
