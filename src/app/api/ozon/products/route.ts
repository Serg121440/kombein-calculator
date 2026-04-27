import { NextRequest, NextResponse } from "next/server";

const OZON_BASE = "https://api-seller.ozon.ru";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { apiKey, clientId, ...params } = body as {
      apiKey: string;
      clientId: string;
      [key: string]: unknown;
    };

    if (!apiKey || !clientId) {
      return NextResponse.json(
        { error: "apiKey and clientId are required" },
        { status: 400 },
      );
    }

    // Fetch product list (up to 1000 items)
    const listRes = await fetch(`${OZON_BASE}/v2/product/list`, {
      method: "POST",
      headers: {
        "Client-Id": clientId,
        "Api-Key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        filter: { visibility: "ALL" },
        last_id: "",
        limit: 1000,
        ...params,
      }),
    });

    if (!listRes.ok) {
      const text = await listRes.text();
      return NextResponse.json(
        { error: `Ozon API error ${listRes.status}: ${text}` },
        { status: listRes.status },
      );
    }

    const listData = (await listRes.json()) as {
      result: { items: Array<{ product_id: number; offer_id: string }> };
    };

    const items = listData.result?.items ?? [];
    if (items.length === 0) {
      return NextResponse.json({ products: [] });
    }

    // Fetch product details
    const infoRes = await fetch(`${OZON_BASE}/v3/product/info/list`, {
      method: "POST",
      headers: {
        "Client-Id": clientId,
        "Api-Key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        offer_id: [],
        product_id: items.map((i) => i.product_id),
        sku: [],
      }),
    });

    if (!infoRes.ok) {
      const text = await infoRes.text();
      return NextResponse.json(
        { error: `Ozon info API error ${infoRes.status}: ${text}` },
        { status: infoRes.status },
      );
    }

    const infoData = (await infoRes.json()) as {
      result: {
        items: Array<{
          id: number;
          offer_id: string;
          name: string;
          category_id: number;
          price: string;
          old_price: string;
          purchase_price?: string;
          weight: number;
          depth: number;
          width: number;
          height: number;
          images: string[];
        }>;
      };
    };

    return NextResponse.json({ products: infoData.result?.items ?? [] });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
