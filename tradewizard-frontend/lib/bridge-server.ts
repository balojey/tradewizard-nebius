const BRIDGE_API_URL = "https://bridge.polymarket.com";

/**
 * Attach the optional builder code so Polymarket can attribute bridge traffic
 * to TradeWizard and prioritize stuck transfers.
 */
export function bridgeHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  const builderCode = process.env.POLYMARKET_BUILDER_CODE;
  if (builderCode) {
    headers["X-Builder-Code"] = builderCode;
  }

  return headers;
}

export async function bridgePost(
  path: string,
  payload: Record<string, unknown>
): Promise<{ status: number; body: string }> {
  const response = await fetch(`${BRIDGE_API_URL}${path}`, {
    method: "POST",
    headers: bridgeHeaders(),
    body: JSON.stringify(payload),
    cache: "no-store",
  });

  return { status: response.status, body: await response.text() };
}

export async function bridgeGet(
  path: string
): Promise<{ status: number; body: string }> {
  const response = await fetch(`${BRIDGE_API_URL}${path}`, {
    method: "GET",
    headers: bridgeHeaders(),
    cache: "no-store",
  });

  return { status: response.status, body: await response.text() };
}
