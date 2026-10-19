import { NextRequest, NextResponse } from "next/server";
import { findMarketBySlug } from "@/lib/market-search";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const slug = searchParams.get("slug");

  if (!slug) {
    return NextResponse.json(
      { error: "slug parameter is required" },
      { status: 400 }
    );
  }

  try {
    const market = await findMarketBySlug(slug);
    
    if (!market) {
      return NextResponse.json({ error: "Market not found" }, { status: 404 });
    }

    return NextResponse.json(market);
  } catch (error) {
    console.error("Error fetching market by slug:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to fetch market by slug",
      },
      { status: 500 }
    );
  }
}