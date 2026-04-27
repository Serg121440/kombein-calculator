import { NextRequest, NextResponse } from "next/server";

const BASE = "https://api-seller.ozon.ru";

type OzonHeaders = Record<string, string>;

async function ozonPost<T>(
  path: string,
  headers: OzonHeaders,
  body: unknown,
): Promise<{ data: T | null; error: string | null; status: number }> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    return { data: null, error: `Ozon ${path} → ${res.status}: ${text}`, status: res.status };
  }
  try {
    return { data: JSON.parse(text) as T, error: null, status: res.status };
  } catch {
    return { data: null, error: `Ozon ${path} → invalid JSON`, status: 500 };
  }
}

interface ListItem { product_id: number; offer_id: string }
interface ListResult { result: { items: ListItem[]; last_id: string; total: number } }

interface InfoItem {
  id: number;
  offer_id: string;
  name: string;
  depth: number;
  width: number;
  height: number;
  weight: number;
  dimension_unit?: string;
  weight_unit?: string;
}
interface InfoResult { result: { items: InfoItem[] } }

interface PriceItem {
  product_id: number;
  offer_id: string;
  price: { price: string; min_price?: string };
}
interface PricesResult { result: { items: PriceItem[] } }

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { apiKey, clientId } = body as { apiKey: string; clientId: string };

    if (!apiKey || !clientId) {
      return NextResponse.json({ error: "apiKey and clientId are required" }, { status: 400 });
    }

    const hdrs: OzonHeaders = {
      "Client-Id": clientId,
      "Api-Key": apiKey,
      "Content-Type": "application/json",
    };

    // Step 1: get product IDs (v3)
    const listResp = await ozonPost<ListResult>("/v3/product/list", hdrs, {
      filter: { visibility: "ALL" },
      last_id: "",
      limit: 1000,
    });
    if (listResp.error) {
      return NextResponse.json({ error: listResp.error }, { status: listResp.status });
    }
    const items: ListItem[] = listResp.data?.result?.items ?? [];
    if (items.length === 0) return NextResponse.json({ products: [] });

    const productIds = items.map((i) => i.product_id);

    // Step 2: info (name, dimensions, weight)
    const infoResp = await ozonPost<InfoResult>("/v3/product/info/list", hdrs, {
      offer_id: [],
      product_id: productIds,
      sku: [],
    });
    const infoMap = new Map<number, InfoItem>();
    for (const item of infoResp.data?.result?.items ?? []) {
      infoMap.set(item.id, item);
    }

    // Step 3: prices (v4)
    const pricesResp = await ozonPost<PricesResult>("/v4/product/info/prices", hdrs, {
      filter: { product_id: productIds, visibility: "ALL" },
      last_id: "",
      limit: 1000,
    });
    const priceMap = new Map<number, PriceItem>();
    for (const item of pricesResp.data?.result?.items ?? []) {
      priceMap.set(item.product_id, item);
    }

    // Merge
    const products = items.map((listItem) => {
      const info = infoMap.get(listItem.product_id);
      const price = priceMap.get(listItem.product_id);

      // Ozon returns depth/width/height in mm, weight in g
      const dimUnit = info?.dimension_unit ?? "mm";
      const weightUnit = info?.weight_unit ?? "g";
      const dimFactor = dimUnit === "mm" ? 0.1 : 1; // mm→cm
      const weightFactor = weightUnit === "g" ? 0.001 : 1; // g→kg

      return {
        product_id: listItem.product_id,
        offer_id: listItem.offer_id,
        name: info?.name ?? listItem.offer_id,
        selling_price: parseFloat(price?.price?.price ?? "0") || 0,
        min_price: parseFloat(price?.price?.min_price ?? "0") || 0,
        depth_cm: (info?.depth ?? 0) * dimFactor,
        width_cm: (info?.width ?? 0) * dimFactor,
        height_cm: (info?.height ?? 0) * dimFactor,
        weight_kg: (info?.weight ?? 0) * weightFactor,
      };
    });

    return NextResponse.json({ products });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
