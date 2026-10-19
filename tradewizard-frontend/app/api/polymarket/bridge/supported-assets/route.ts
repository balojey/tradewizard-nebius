import { NextResponse } from "next/server";

const BRIDGE_API_URL = "https://bridge.polymarket.com";

/**
 * Proxy Polymarket's supported-assets list so the browser never talks to a
 * third-party host directly and the response can be cached at the edge.
 */
export async function GET() {
  try {
    const response = await fetch(`${BRIDGE_API_URL}/supported-assets`, {
      headers: { Accept: "application/json" },
      next: { revalidate: 300 },
    });

    const body = await response.text();
    return new NextResponse(body, {
      status: response.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Bridge supported-assets proxy failed:", error);
    return NextResponse.json(
      { error: "Failed to load bridge assets" },
      { status: 502 }
    );
  }
}
