import { NextRequest, NextResponse } from "next/server";
import { bridgePost } from "@/lib/bridge-server";

/**
 * Create Polymarket bridge deposit addresses for the user's trading wallet.
 * The bridge credits pUSD to the wallet after the deposit is converted.
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { address?: string };

    if (!body?.address || !/^0x[a-fA-F0-9]{40}$/.test(body.address)) {
      return NextResponse.json(
        { error: "A valid wallet address is required" },
        { status: 400 }
      );
    }

    const { status, body: responseBody } = await bridgePost("/deposit", {
      address: body.address,
    });

    return new NextResponse(responseBody, {
      status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Bridge deposit proxy failed:", error);
    return NextResponse.json(
      { error: "Failed to create deposit addresses" },
      { status: 502 }
    );
  }
}
