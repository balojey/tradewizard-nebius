/**
 * Polymarket collateral + Protocol V2 constants.
 *
 * TradeWizard is migrating from USDC.e to pUSD (Polymarket USD) as the canonical
 * collateral. User-facing UI must never surface these token names, addresses,
 * wrapping, or bridging - everything is displayed as USD.
 *
 * Reference: https://docs.polymarket.com/resources/contracts
 */

// ─── Collateral ───────────────────────────────────────────────────────────────

/** pUSD (Polymarket USD) - ERC-20 collateral on Polygon. */
export const PUSD_CONTRACT_ADDRESS =
  "0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB" as const;

export const PUSD_DECIMALS = 6;

/** USDC.e - legacy collateral retained only for migration/read compatibility. */
export const USDC_E_CONTRACT_ADDRESS =
  "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174" as const;

export const USDC_E_DECIMALS = 6;

// ─── Collateral Ramp ──────────────────────────────────────────────────────────

export const COLLATERAL_ONRAMP_ADDRESS =
  "0x93070a847efEf7F70739046A929D47a521F5B8ee" as const;

export const COLLATERAL_OFFRAMP_ADDRESS =
  "0x2957922Eb93258b93368531d39fAcCA3B4dC5854" as const;

// ─── Polymarket Protocol V2 Exchanges ─────────────────────────────────────────

/** ExchangeV3 - settles Polymarket V2 position orders. */
export const EXCHANGE_V3_ADDRESS =
  "0xe3333700cA9d93003F00f0F71f8515005F6c00Aa" as const;

/** Standard CTF Exchange V2. */
export const CTF_EXCHANGE_V2_ADDRESS =
  "0xE111180000d2663C0091e4f400237545B87B996B" as const;

/** Neg Risk CTF Exchange V2. */
export const NEG_RISK_CTF_EXCHANGE_V2_ADDRESS =
  "0xe2222d279d744050d28e00520010520000310F59" as const;

/** PositionManager - owns Polymarket V2 ERC-1155 position balances. */
export const POSITION_MANAGER_ADDRESS =
  "0x006F54F7f9A22e0000CC2AB60031000000ae9fEF" as const;

// ─── Wallets ──────────────────────────────────────────────────────────────────

export const DEPOSIT_WALLET_FACTORY_ADDRESS =
  "0x00000000000Fb5C9ADea0298D729A0CB3823Cc07" as const;

export const DEPOSIT_WALLET_BEACON_ADDRESS =
  "0x7A18EDfe055488A3128f01F563e5B479D92ffc3a" as const;

// ─── Bridge ───────────────────────────────────────────────────────────────────

export const POLYMARKET_BRIDGE_API_URL = "https://bridge.polymarket.com";

/** Collateral that the TradeWizard UI treats as the canonical USD balance. */
export const USD_DISPLAY_DECIMALS = 6;
