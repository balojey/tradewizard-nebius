/**
 * TradeWizard's unified Polymarket client.
 *
 * Wraps the modern `@polymarket/client` SDK so the app can trade with pUSD,
 * support Protocol V2 and legacy CTF markets, and use Deposit Wallets - all
 * behind the same UI.
 *
 * The legacy `@polymarket/clob-client` stack remains in place during the
 * migration window; new code should prefer this client.
 */

import { createSecureClient, remoteBuilderSigning } from "@polymarket/client";
import { signerFrom } from "@polymarket/client/ethers-v5";
import type { providers } from "ethers";
import { REMOTE_SIGNING_URL } from "@/constants/polymarket";

export type TradeWizardSecureClient = Awaited<
  ReturnType<typeof createSecureClient>
>;

export interface CreateTradeWizardClientParams {
  /** Ethers v5 signer (e.g. the Magic EOA signer). */
  ethersSigner: providers.JsonRpcSigner;
  /**
   * Account wallet to trade as. Omit to use the signer's deterministic
   * Deposit Wallet (the modern default), or pass a legacy Safe/Proxy address
   * to keep using it.
   */
  walletAddress?: string;
  /** Existing CLOB L2 credentials to reuse when still valid. */
  credentials?: {
    key: string;
    secret: string;
    passphrase: string;
  };
}

/**
 * Create an authenticated SecureClient using TradeWizard's remote builder
 * signing endpoint. Works with Deposit Wallets, Safe wallets, and Proxy
 * wallets.
 */
export async function createTradeWizardClient(
  params: CreateTradeWizardClientParams
): Promise<TradeWizardSecureClient> {
  const base = {
    signer: signerFrom(params.ethersSigner as never),
    apiKey: remoteBuilderSigning({ url: REMOTE_SIGNING_URL() }),
    ...(params.walletAddress ? { wallet: params.walletAddress } : {}),
  };

  if (params.credentials) {
    return createSecureClient({
      ...base,
      credentials: params.credentials as never,
    });
  }

  return createSecureClient({ ...base, nonce: 0 });
}
