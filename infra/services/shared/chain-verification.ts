/**
 * On-chain verification module for USDC.e transfers on Polygon.
 * Uses viem to verify transaction receipts, read contract state,
 * and derive deterministic Safe addresses.
 *
 * Requirements: 1.3, 1.7, 2.2, 4.3, 4.7, 8.2, 9.2, 9.3, 9.4
 */

import {
  createPublicClient,
  http,
  parseAbi,
  getAddress,
  getContractAddress,
  keccak256,
  encodePacked,
  decodeEventLog,
  type PublicClient,
  type Log,
  type TransactionReceipt,
  type Address,
} from 'viem';
import { polygon } from 'viem/chains';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const POLYGON_RPC_URL = process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com';
const USDC_CONTRACT_ADDRESS = (process.env.USDC_CONTRACT_ADDRESS ||
  '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174') as Address;
/** pUSD (Polymarket USD) - canonical collateral during the migration. */
const PUSD_CONTRACT_ADDRESS = (process.env.PUSD_CONTRACT_ADDRESS ||
  '0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB') as Address;
/** Tokens accepted for payment/balance during the migration window. */
const COLLATERAL_TOKEN_ADDRESSES = [PUSD_CONTRACT_ADDRESS, USDC_CONTRACT_ADDRESS];
const SAFE_FACTORY_ADDRESS = (process.env.SAFE_FACTORY_ADDRESS ||
  '0x0000000000000000000000000000000000000000') as Address;
const PLATFORM_WALLET_ADDRESS = (process.env.PLATFORM_WALLET_ADDRESS ||
  '0x0000000000000000000000000000000000000000') as Address;

// ---------------------------------------------------------------------------
// ABI Definitions
// ---------------------------------------------------------------------------

const ERC20_ABI = parseAbi([
  'event Transfer(address indexed from, address indexed to, uint256 value)',
  'function balanceOf(address account) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
]);

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface TransferVerification {
  txHash: string;
  expectedSender: string;
  expectedRecipient: string;
  expectedAmount: bigint;
  /**
   * Accepted collateral contracts. Defaults to pUSD + legacy USDC.e so
   * payments work during the migration window.
   */
  tokenAddresses?: string[];
}

export type VerificationErrorCode =
  | 'TX_NOT_FOUND'
  | 'TX_PENDING'
  | 'TX_REVERTED'
  | 'SENDER_MISMATCH'
  | 'RECIPIENT_MISMATCH'
  | 'AMOUNT_MISMATCH';

export interface VerificationResult {
  verified: boolean;
  error?: VerificationErrorCode;
  actualSender?: string;
  actualRecipient?: string;
  actualAmount?: bigint;
  blockNumber?: bigint;
}

export interface TransferLog {
  from: string;
  to: string;
  value: bigint;
}

// ---------------------------------------------------------------------------
// Public Client (cached for Lambda reuse)
// ---------------------------------------------------------------------------

let cachedClient: PublicClient | null = null;

export function getPublicClient(): PublicClient {
  if (cachedClient) return cachedClient;

  cachedClient = createPublicClient({
    chain: polygon,
    transport: http(POLYGON_RPC_URL),
  });

  return cachedClient;
}

// ---------------------------------------------------------------------------
// Core Verification Functions
// ---------------------------------------------------------------------------

/**
 * Parse Transfer event logs from a transaction receipt and verify
 * that the expected sender, recipient, and amount match.
 *
 * This is a pure function operating on parsed logs - testable without
 * network access.
 */
export function verifyTransferEvent(
  logs: TransferLog[],
  expected: Omit<TransferVerification, 'txHash'>
): VerificationResult {
  const normalizedExpectedSender = expected.expectedSender.toLowerCase();
  const normalizedExpectedRecipient = expected.expectedRecipient.toLowerCase();

  // Find the matching USDC.e Transfer event
  const transferLog = logs.find(
    (log) =>
      log.from.toLowerCase() === normalizedExpectedSender &&
      log.to.toLowerCase() === normalizedExpectedRecipient &&
      log.value === expected.expectedAmount
  );

  if (transferLog) {
    return { verified: true };
  }

  // If no exact match, determine the specific mismatch
  // Check if there's any transfer from the expected sender
  const senderLogs = logs.filter(
    (log) => log.from.toLowerCase() === normalizedExpectedSender
  );

  if (senderLogs.length === 0) {
    // No transfer from expected sender at all - check if there's any transfer
    if (logs.length > 0) {
      const firstLog = logs[0];
      return {
        verified: false,
        error: 'SENDER_MISMATCH',
        actualSender: firstLog.from,
        actualRecipient: firstLog.to,
        actualAmount: firstLog.value,
      };
    }
    // No Transfer events at all
    return {
      verified: false,
      error: 'SENDER_MISMATCH',
    };
  }

  // Sender matches - check recipient
  const recipientLogs = senderLogs.filter(
    (log) => log.to.toLowerCase() === normalizedExpectedRecipient
  );

  if (recipientLogs.length === 0) {
    const firstSenderLog = senderLogs[0];
    return {
      verified: false,
      error: 'RECIPIENT_MISMATCH',
      actualSender: firstSenderLog.from,
      actualRecipient: firstSenderLog.to,
      actualAmount: firstSenderLog.value,
    };
  }

  // Sender and recipient match - amount must be wrong
  const firstMatch = recipientLogs[0];
  return {
    verified: false,
    error: 'AMOUNT_MISMATCH',
    actualSender: firstMatch.from,
    actualRecipient: firstMatch.to,
    actualAmount: firstMatch.value,
  };
}

/**
 * Full verification flow: fetches the transaction receipt from chain,
 * parses Transfer logs, and verifies against expected values.
 */
export async function verifyTransaction(
  verification: TransferVerification
): Promise<VerificationResult> {
  const client = getPublicClient();

  // Fetch transaction to check if it exists and is confirmed
  let receipt: TransactionReceipt;
  try {
    const tx = await client.getTransaction({
      hash: verification.txHash as `0x${string}`,
    });

    if (!tx.blockNumber) {
      return { verified: false, error: 'TX_PENDING' };
    }

    receipt = await client.getTransactionReceipt({
      hash: verification.txHash as `0x${string}`,
    });
  } catch (error: unknown) {
    // Transaction not found
    return { verified: false, error: 'TX_NOT_FOUND' };
  }

  // Check if transaction was reverted
  if (receipt.status === 'reverted') {
    return { verified: false, error: 'TX_REVERTED' };
  }

  // Parse Transfer events from the accepted collateral contracts
  const transferLogs = parseTransferLogs(
    receipt.logs,
    verification.tokenAddresses ?? COLLATERAL_TOKEN_ADDRESSES
  );

  // Verify the transfer event matches expectations
  const result = verifyTransferEvent(transferLogs, {
    expectedSender: verification.expectedSender,
    expectedRecipient: verification.expectedRecipient,
    expectedAmount: verification.expectedAmount,
  });

  if (result.verified) {
    return { ...result, blockNumber: receipt.blockNumber };
  }

  return result;
}

/**
 * Parse raw logs from a transaction receipt into TransferLog objects.
 * Filters for Transfer events from the accepted collateral contracts.
 */
export function parseTransferLogs(
  logs: Log[],
  tokenAddresses: string[] = COLLATERAL_TOKEN_ADDRESSES
): TransferLog[] {
  const transferLogs: TransferLog[] = [];
  const accepted = new Set(tokenAddresses.map((address) => address.toLowerCase()));

  for (const log of logs) {
    // Only process logs from accepted collateral contracts
    if (!accepted.has(log.address.toLowerCase())) {
      continue;
    }

    try {
      const decoded = decodeEventLog({
        abi: ERC20_ABI,
        data: log.data,
        topics: log.topics,
      });

      if (decoded.eventName === 'Transfer') {
        const args = decoded.args as { from: Address; to: Address; value: bigint };
        transferLogs.push({
          from: args.from,
          to: args.to,
          value: args.value,
        });
      }
    } catch {
      // Skip logs that don't match the Transfer event signature
      continue;
    }
  }

  return transferLogs;
}

// ---------------------------------------------------------------------------
// Contract Read Functions
// ---------------------------------------------------------------------------

/**
 * Read the legacy USDC.e allowance granted by a wallet to the Platform Wallet.
 * Kept for backward compatibility during the migration window.
 */
export async function readAllowance(
  safeAddress: string,
  platformWallet?: string
): Promise<bigint> {
  return readTokenAllowance(USDC_CONTRACT_ADDRESS, safeAddress, platformWallet);
}

/** Read an ERC-20 allowance for a specific collateral token. */
export async function readTokenAllowance(
  tokenAddress: string,
  owner: string,
  spender?: string
): Promise<bigint> {
  const client = getPublicClient();
  const resolvedSpender = spender || PLATFORM_WALLET_ADDRESS;

  return client.readContract({
    address: getAddress(tokenAddress),
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [getAddress(owner), getAddress(resolvedSpender)],
  });
}

/** Read allowances for both pUSD and legacy USDC.e. */
export async function readCollateralAllowances(
  owner: string,
  platformWallet?: string
): Promise<{ pusd: bigint; usdce: bigint }> {
  const [pusd, usdce] = await Promise.all([
    readTokenAllowance(PUSD_CONTRACT_ADDRESS, owner, platformWallet),
    readTokenAllowance(USDC_CONTRACT_ADDRESS, owner, platformWallet),
  ]);

  return { pusd, usdce };
}

/** Read the balance of a specific ERC-20 token. */
export async function readTokenBalance(
  tokenAddress: string,
  address: string
): Promise<bigint> {
  const client = getPublicClient();

  return client.readContract({
    address: getAddress(tokenAddress),
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [getAddress(address)],
  });
}

/**
 * Read the user's total collateral balance (pUSD + legacy USDC.e), in 6-decimal
 * base units. The UI presents this as a single USD balance.
 */
export async function readBalance(address: string): Promise<bigint> {
  const [pusd, usdce] = await Promise.all([
    readTokenBalance(PUSD_CONTRACT_ADDRESS, address),
    readTokenBalance(USDC_CONTRACT_ADDRESS, address),
  ]);

  return pusd + usdce;
}

// ---------------------------------------------------------------------------
// Safe Address Derivation
// ---------------------------------------------------------------------------

/**
 * Derive the deterministic Safe (proxy) address from an EOA address
 * and the Safe factory address using CREATE2.
 *
 * The Safe proxy is deployed via CREATE2 with:
 * - Factory address (deployer)
 * - Salt derived from the EOA address (keccak256 of the EOA)
 * - Bytecode hash of the Safe proxy contract
 *
 * This matches the Polymarket Safe derivation pattern where each EOA
 * maps to exactly one deterministic Safe address.
 *
 * Requirements: 9.1, 9.2, 9.4
 */
export function deriveSafeAddress(
  eoaAddress: string,
  factoryAddress?: string
): string {
  const factory = factoryAddress || SAFE_FACTORY_ADDRESS;
  const normalizedEoa = getAddress(eoaAddress);
  const normalizedFactory = getAddress(factory);

  // Salt is derived from the EOA address - ensures deterministic 1:1 mapping
  const salt = keccak256(encodePacked(['address'], [normalizedEoa]));

  // Safe proxy bytecode init code hash (GnosisSafeProxy)
  // This is the standard init code hash for Gnosis Safe Proxy Factory
  const SAFE_PROXY_INIT_CODE_HASH =
    '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470' as `0x${string}`;

  // CREATE2 address derivation: keccak256(0xff ++ factory ++ salt ++ initCodeHash)
  const derivedAddress = getContractAddress({
    bytecode: SAFE_PROXY_INIT_CODE_HASH,
    from: normalizedFactory,
    opcode: 'CREATE2',
    salt,
  });

  return derivedAddress;
}

// ---------------------------------------------------------------------------
// Exports for testing
// ---------------------------------------------------------------------------

export {
  USDC_CONTRACT_ADDRESS,
  PUSD_CONTRACT_ADDRESS,
  COLLATERAL_TOKEN_ADDRESSES,
  SAFE_FACTORY_ADDRESS,
  PLATFORM_WALLET_ADDRESS,
};
