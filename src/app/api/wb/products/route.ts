import { NextRequest, NextResponse } from "next/server";

const WB_BASE = "https://content-api.wildberries.ru";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { apiKey } = body as { apiKey: string };

    if (!apiKey) {
      return NextResponse.json(
        { error: "apiKey is required" },
        { status: 400 },
      );
    }

    // WB Content API v2: get all cards
    const res = await fetch(`${WB_BASE}/content/v2/get/cards/list`, {
      method: "POST",
      headers: {
        Authorization: apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        settings: {
          cursor: { limit: 100 },
          filter: { withPhoto: -1 },
        },
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json(
        { error: `WB API error ${res.status}: ${text}` },
        { status: res.status },
      );
    }

    const data = (await res.json()) as {
      cards: Array<{
        nmID: number;
        vendorCode: string;
        title: string;
        subjectName: string;
        salePriceU?: number;
        sizes?: Array<{ techSize: string; skus: string[] }>;
        dimensions?: { length: number; width: number; height: number; weightGross: number };
      }>;
    };

    return NextResponse.json({ cards: data.cards ?? [] });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
