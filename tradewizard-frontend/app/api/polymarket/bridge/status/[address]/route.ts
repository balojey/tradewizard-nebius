import { NextRequest, NextResponse } from "next/server";
import { bridgeGet } from "@/lib/bridge-server";

interface RouteContext {
  params: Promise<{ address: string }>;
}

/**
 * Track a bridge transfer by the bridge address (not the wallet address).
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { address } = await context.params;
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return NextResponse.json(
        { error: "A valid bridge address is required" },
        { status: 400 }
      );
    }

    const limit = request.nextUrl.searchParams.get("limit") || "50";
    const cursor = request.nextUrl.searchParams.get("cursor");

    const query = new URLSearchParams({ limit });
    if (cursor) query.set("cursor", cursor);

    const { status, body } = await bridgeGet(
      `/status/${address}?${query.toString()}`
    );

    return new NextResponse(body, {
      status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Bridge status proxy failed:", error);
    return NextResponse.json(
      { error: "Failed to load bridge status" },
      { status: 502 }
    );
  }
}
