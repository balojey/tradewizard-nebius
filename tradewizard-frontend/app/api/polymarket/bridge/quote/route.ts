import { NextRequest, NextResponse } from "next/server";
import { bridgePost } from "@/lib/bridge-server";

/**
 * Preview fees and estimated output for a bridge transfer.
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const required = [
      "fromAmountBaseUnit",
      "fromChainId",
      "fromTokenAddress",
      "recipientAddress",
      "toChainId",
      "toTokenAddress",
    ];

    const missing = required.filter((field) => !body?.[field]);
    if (missing.length > 0) {
      return NextResponse.json(
        { error: `Missing required fields: ${missing.join(", ")}` },
        { status: 400 }
      );
    }

    const { status, body: responseBody } = await bridgePost("/quote", body);

    return new NextResponse(responseBody, {
      status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Bridge quote proxy failed:", error);
    return NextResponse.json(
      { error: "Failed to load quote" },
      { status: 502 }
    );
  }
}
