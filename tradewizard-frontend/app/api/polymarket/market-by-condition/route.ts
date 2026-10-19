import { NextRequest, NextResponse } from "next/server";
import { CLOB_API_URL } from "@/constants/api";

/**
 * API Route: Get Market Details by Condition ID
 * 
 * Fetches market details from Polymarket CLOB API using condition_id.
 * This is essential for closed markets where we only have the condition_id stored.
 * 
 * @param conditionId - The Polymarket condition ID
 * @returns Market details including slug, question, outcomes, etc.
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const conditionId = searchParams.get("conditionId");

  if (!conditionId) {
    return NextResponse.json(
      { error: "conditionId parameter is required" },
      { status: 400 }
    );
  }

  try {
    // Fetch market details from CLOB API using condition_id
    const response = await fetch(
      `${CLOB_API_URL}/markets/${conditionId}`,
      {
        headers: {
          "Content-Type": "application/json",
        },
        next: { revalidate: 300 }, // Cache for 5 minutes
      }
    );

    if (!response.ok) {
      console.error(`CLOB API error for condition ${conditionId}:`, response.status);
      
      // If market not found, return 404
      if (response.status === 404) {
        return NextResponse.json(
          { error: "Market not found" },
          { status: 404 }
        );
      }
      
      throw new Error(`CLOB API error: ${response.status}`);
    }

    const market = await response.json();

    if (!market) {
      return NextResponse.json(
        { error: "Market not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(market);
  } catch (error) {
    console.error("Error fetching market by condition ID:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to fetch market by condition ID",
      },
      { status: 500 }
    );
  }
}
