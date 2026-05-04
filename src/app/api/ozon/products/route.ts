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
    const body = await req.json() as { apiKey?: string; clientId?: string };
    const { apiKey, clientId } = body;

    console.log("[ozon/products] clientId=%s keyLen=%d keyPrefix=%s",
      clientId,
      apiKey?.length ?? 0,
      apiKey?.slice(0, 8) ?? "(none)",
    );

    if (!apiKey || !clientId) {
      return NextResponse.json(
        { error: "apiKey и clientId обязательны" },
        { status: 400 },
      );
    }

    const { products, warnings } = await fetchAllProducts(apiKey, clientId);
    if (warnings.length > 0) console.warn("[ozon/products] warnings:", warnings);
    console.log("[ozon/products] success count=%d", products.length);
    return NextResponse.json({ products, warnings });
  } catch (err) {
    const msg = (err as Error).message;
    console.error("[ozon/products] error:", msg);
    return NextResponse.json({ error: msg + ozonHint(msg) }, { status: 500 });
  }
}
