import { NextRequest, NextResponse } from "next/server";
import { fetchAllProducts } from "@/lib/api/ozon";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const { apiKey, clientId } = (await req.json()) as {
      apiKey: string;
      clientId: string;
    };

    if (!apiKey || !clientId) {
      return NextResponse.json(
        { error: "apiKey and clientId are required" },
        { status: 400 },
      );
    }

    const products = await fetchAllProducts(apiKey, clientId);
    return NextResponse.json({ products });
  } catch (err) {
    const msg = (err as Error).message;
    console.error("[ozon/products]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
