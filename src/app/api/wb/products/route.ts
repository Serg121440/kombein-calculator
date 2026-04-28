import { NextRequest, NextResponse } from "next/server";
import { fetchAllCards } from "@/lib/api/wb";

export async function POST(req: NextRequest) {
  try {
    const { apiKey } = (await req.json()) as { apiKey: string };

    if (!apiKey) {
      return NextResponse.json({ error: "apiKey is required" }, { status: 400 });
    }

    const cards = await fetchAllCards(apiKey);
    return NextResponse.json({ cards });
  } catch (err) {
    const msg = (err as Error).message;
    console.error("[wb/products]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
