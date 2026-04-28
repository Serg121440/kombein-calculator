import { NextRequest, NextResponse } from "next/server";
import { fetchTransactions } from "@/lib/api/ozon";

export const maxDuration = 60;

function ozonHint(msg: string): string {
  if (msg.includes("[401]"))
    return " Проверьте API-ключ Ozon.";
  if (msg.includes("[403]"))
    return " API-ключ не имеет доступа к финансовым данным. Включите разрешение «Финансы» в настройках ключа.";
  if (msg.includes("[404]"))
    return " Проверьте Client-ID (числовой ID продавца в Настройки → API ключи).";
  return "";
}

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
        { error: "apiKey и clientId обязательны" },
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
    const hint = ozonHint(msg);
    console.error("[ozon/transactions]", msg);
    return NextResponse.json({ operations: [], warning: msg + hint });
  }
}
