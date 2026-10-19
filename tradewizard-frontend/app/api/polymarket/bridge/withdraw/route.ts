import { NextRequest, NextResponse } from "next/server";
import { bridgePost } from "@/lib/bridge-server";

/**
 * Create Polymarket bridge withdrawal addresses. The user then sends pUSD from
 * their trading wallet to the returned EVM address to withdraw to the chosen
 * chain and token.
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      address?: string;
      toChainId?: string;
      toTokenAddress?: string;
      recipientAddr?: string;
    };

    if (
      !body?.address ||
      !/^0x[a-fA-F0-9]{40}$/.test(body.address) ||
      !body.toChainId ||
      !body.toTokenAddress ||
      !body.recipientAddr
    ) {
      return NextResponse.json(
        { error: "address, toChainId, toTokenAddress, and recipientAddr are required" },
        { status: 400 }
      );
    }

    const { status, body: responseBody } = await bridgePost("/withdraw", {
      address: body.address,
      toChainId: body.toChainId,
      toTokenAddress: body.toTokenAddress,
      recipientAddr: body.recipientAddr,
    });

    return new NextResponse(responseBody, {
      status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Bridge withdraw proxy failed:", error);
    return NextResponse.json(
      { error: "Failed to create withdrawal addresses" },
      { status: 502 }
    );
  }
}
