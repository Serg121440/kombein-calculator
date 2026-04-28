import { NextRequest, NextResponse } from "next/server";
import { fetchAllCards, fetchPrices, type WbCardsCursor } from "@/lib/api/wb";

export async function POST(req: NextRequest) {
  try {
    const { apiKey, prevCursor } = (await req.json()) as {
      apiKey: string;
      prevCursor?: WbCardsCursor;
    };

    if (!apiKey) {
      return NextResponse.json({ error: "apiKey is required" }, { status: 400 });
    }

    const [{ cards, nextCursor }, prices] = await Promise.all([
      fetchAllCards(apiKey, prevCursor),
      fetchPrices(apiKey),
    ]);

    // Build nmID → discountedPrice map from prices API
    const priceMap = new Map(prices.map((p) => [p.nmID, p.discountedPrice]));

    // Enrich cards: replace salePriceU with accurate price from prices API
    const enriched = cards.map((c) => ({
      ...c,
      // prices API returns roubles; fallback to salePriceU/100 if prices API missed it
      sellingPrice: priceMap.get(c.nmID) ?? (c.salePriceU ? c.salePriceU / 100 : 0),
    }));

    return NextResponse.json({ cards: enriched, nextCursor });
  } catch (err) {
    const msg = (err as Error).message;
    console.error("[wb/products]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
