import { NextRequest, NextResponse } from "next/server";
import { fetchAllProducts } from "@/lib/api/ozon";

export const maxDuration = 60;

function ozonHint(msg: string): string {
  if (msg.includes("[401]"))
    return " Проверьте правильность API-ключа Ozon (Settings → API keys).";
  if (msg.includes("[403]"))
    return " API-ключ не имеет нужных прав. Включите разрешения в настройках Ozon Seller.";
  if (msg.includes("[404]"))
    return " Проверьте Client-ID — это числовой идентификатор продавца (Настройки → API ключи → Client ID).";
  return "";
}

export async function POST(req: NextRequest) {
  try {
    const { apiKey, clientId } = (await req.json()) as {
      apiKey: string;
      clientId: string;
    };

    if (!apiKey || !clientId) {
      return NextResponse.json(
        { error: "apiKey и clientId обязательны" },
        { status: 400 },
      );
    }

    const products = await fetchAllProducts(apiKey, clientId);
    return NextResponse.json({ products });
  } catch (err) {
    const msg = (err as Error).message;
    console.error("[ozon/products]", msg);
    return NextResponse.json({ error: msg + ozonHint(msg) }, { status: 500 });
  }
}
