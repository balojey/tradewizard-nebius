import { useState, useCallback, useEffect } from "react";
import { encodeFunctionData, erc20Abi, parseAbi } from "viem";
import { OperationType } from "@polymarket/builder-relayer-client";
import useRelayClient from "@/hooks/useRelayClient";
import { useWallet } from "@/providers/WalletContext";
import useSafeDeployment from "@/hooks/useSafeDeployment";
import {
  createTradeWizardClient,
  type TradeWizardSecureClient,
} from "@/lib/polymarket-client";
import {
  COLLATERAL_ONRAMP_ADDRESS,
  USDC_E_CONTRACT_ADDRESS,
} from "@/constants/collateral";

import {
  loadSession,
  saveSession,
  clearSession as clearStoredSession,
  TradingSession,
  SessionStep,
} from "@/utils/session";

const ONRAMP_ABI = parseAbi([
  "function wrap(address _asset, address _to, uint256 _amount)",
]);

/**
 * Manages the user's Polymarket trading session.
 *
 * The modern Deposit Wallet is the default account. Legacy Safe accounts are
 * migrated automatically: their USDC.e is wrapped into pUSD on the new Deposit
 * Wallet, so the user never sees a token, wrap, or migration step.
 */
export default function useTradingSession() {
  const [currentStep, setCurrentStep] = useState<SessionStep>("idle");
  const [sessionError, setSessionError] = useState<Error | null>(null);
  const [tradingSession, setTradingSession] = useState<TradingSession | null>(
    null
  );
  const [secureClient, setSecureClient] =
    useState<TradeWizardSecureClient | null>(null);

  const { eoaAddress, walletClient, ethersSigner, publicClient } = useWallet();
  const { derivedSafeAddressFromEoa, isSafeDeployed, deploySafe } =
    useSafeDeployment(eoaAddress);
  const { relayClient, initializeRelayClient, clearRelayClient } =
    useRelayClient();

  // Load any stored session when the wallet connects.
  useEffect(() => {
    if (!eoaAddress) {
      setTradingSession(null);
      setCurrentStep("idle");
      setSessionError(null);
      return;
    }

    const stored = loadSession(eoaAddress);
    setTradingSession(stored);

    if (!stored) {
      setCurrentStep("idle");
      setSessionError(null);
      return;
    }
  }, [eoaAddress]);

  // Restore the legacy relay client when a Safe-backed session exists (needed
  // for legacy position redemption while those positions resolve).
  useEffect(() => {
    if (
      tradingSession &&
      tradingSession.walletType === "SAFE" &&
      !relayClient &&
      eoaAddress &&
      walletClient
    ) {
      initializeRelayClient().catch((err) => {
        console.error("Failed to restore relay client:", err);
      });
    }
  }, [
    tradingSession,
    relayClient,
    eoaAddress,
    walletClient,
    initializeRelayClient,
  ]);

  const initializeTradingSession = useCallback(async () => {
    if (!eoaAddress) throw new Error("Wallet not connected");

    setCurrentStep("checking");
    setSessionError(null);

    try {
      if (!ethersSigner) {
        throw new Error("Wallet signer unavailable");
      }

      const existingWalletAddress = tradingSession?.safeAddress;
      const alreadyOnDepositWallet =
        tradingSession?.walletType === "DEPOSIT_WALLET";

      let client: TradeWizardSecureClient;

      if (existingWalletAddress && !alreadyOnDepositWallet) {
        // Existing Safe account: migrate its USDC.e into pUSD on the new
        // Deposit Wallet in a single hidden relay batch.
        const initializedRelayClient = await initializeRelayClient();

        if (!derivedSafeAddressFromEoa) {
          throw new Error("Failed to derive Safe address");
        }

        const isDeployed = await isSafeDeployed(
          initializedRelayClient,
          derivedSafeAddressFromEoa
        );

        if (!isDeployed) {
          setCurrentStep("deploying");
          await deploySafe(initializedRelayClient);
        }

        setCurrentStep("credentials");
        client = await createTradeWizardClient({ ethersSigner });
        const depositWallet = String(client.account.wallet);

        if (publicClient) {
          const usdcBalance = await publicClient.readContract({
            address: USDC_E_CONTRACT_ADDRESS,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [derivedSafeAddressFromEoa as `0x${string}`],
          });

          if (usdcBalance > BigInt(0)) {
            setCurrentStep("deploying");
            const approveTx = {
              to: USDC_E_CONTRACT_ADDRESS as `0x${string}`,
              operation: OperationType.Call,
              data: encodeFunctionData({
                abi: erc20Abi,
                functionName: "approve",
                args: [COLLATERAL_ONRAMP_ADDRESS, usdcBalance],
              }),
              value: "0",
            };

            const wrapTx = {
              to: COLLATERAL_ONRAMP_ADDRESS as `0x${string}`,
              operation: OperationType.Call,
              data: encodeFunctionData({
                abi: ONRAMP_ABI,
                functionName: "wrap",
                args: [
                  USDC_E_CONTRACT_ADDRESS,
                  depositWallet as `0x${string}`,
                  usdcBalance,
                ],
              }),
              value: "0",
            };

            const migration = await initializedRelayClient.execute(
              [approveTx, wrapTx],
              "Upgrade wallet"
            );
            await migration.wait();
          }
        }
      } else {
        setCurrentStep("credentials");
        client = await createTradeWizardClient({
          ethersSigner,
          ...(alreadyOnDepositWallet && existingWalletAddress
            ? { walletAddress: existingWalletAddress }
            : {}),
        });
      }

      setCurrentStep("approvals");
      await client.setupTradingApprovals();

      const creds = client.credentials;
      const unifiedSession: TradingSession = {
        eoaAddress,
        safeAddress: String(client.account.wallet),
        walletType: "DEPOSIT_WALLET",
        isSafeDeployed: true,
        hasApiCredentials: true,
        hasApprovals: true,
        apiCredentials: {
          key: String(creds.key),
          secret: creds.secret,
          passphrase: creds.passphrase,
        },
        lastChecked: Date.now(),
      };

      setSecureClient(client);
      setTradingSession(unifiedSession);
      saveSession(eoaAddress, unifiedSession);
      setCurrentStep("complete");
    } catch (err) {
      console.error("Session initialization error:", err);
      const error = err instanceof Error ? err : new Error("Unknown error");
      setSessionError(error);
      setCurrentStep("idle");
    }
  }, [
    eoaAddress,
    ethersSigner,
    publicClient,
    derivedSafeAddressFromEoa,
    isSafeDeployed,
    deploySafe,
    initializeRelayClient,
    tradingSession,
  ]);

  const endTradingSession = useCallback(() => {
    if (!eoaAddress) return;

    clearStoredSession(eoaAddress);
    setTradingSession(null);
    setSecureClient(null);
    clearRelayClient();
    setCurrentStep("idle");
    setSessionError(null);
  }, [eoaAddress, clearRelayClient]);

  return {
    tradingSession,
    currentStep,
    sessionError,
    isTradingSessionComplete:
      tradingSession?.isSafeDeployed &&
      tradingSession?.hasApiCredentials &&
      tradingSession?.hasApprovals,
    initializeTradingSession,
    endTradingSession,
    relayClient,
    secureClient,
  };
}
