"use client";

import { ReactNode, useEffect, useMemo, useState, useCallback } from "react";
import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  WalletClient,
} from "viem";
import getMagic from "@/lib/magic";
import { providers } from "ethers";
import { polygon } from "viem/chains";
import { WalletContext, WalletContextType } from "./WalletContext";
import { POLYGON_RPC_URL } from "@/constants/polymarket";
import { cognitoAuthClient } from "@/lib/cognito-auth";
import { useAuthContext } from "./AuthProvider";

const publicClient = createPublicClient({
  chain: polygon,
  transport: http(POLYGON_RPC_URL),
});

/**
 * Sync Magic auth to Cognito by calling the backend magic-sync endpoint.
 * This creates the Cognito user if needed and returns tokens.
 */
async function syncMagicToCognito(email: string): Promise<void> {
  const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';
  try {
    const response = await fetch(`${baseUrl}/auth/magic-sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });

    if (!response.ok) {
      console.error('Magic-Cognito sync failed:', response.status);
      return;
    }

    const tokens = await response.json();

    // Store Cognito tokens using the auth client's storage mechanism
    if (typeof window !== 'undefined' && tokens.idToken) {
      localStorage.setItem('tw_id_token', tokens.idToken);
      localStorage.setItem('tw_access_token', tokens.accessToken);
      localStorage.setItem('tw_refresh_token', tokens.refreshToken);
      localStorage.setItem(
        'tw_expires_at',
        String(Date.now() + (tokens.expiresIn ?? 3600) * 1000)
      );
    }
  } catch (error) {
    console.error('Magic-Cognito sync error:', error);
  }
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const { refreshFromStorage } = useAuthContext();
  const [ethersSigner, setEthersSigner] =
    useState<providers.JsonRpcSigner | null>(null);
  const [walletClient, setWalletClient] = useState<WalletClient | null>(null);
  const [eoaAddress, setEoaAddress] = useState<`0x${string}` | undefined>(
    undefined
  );

  useEffect(() => {
    const magic = getMagic();
    if (!magic) return;

    const client = createWalletClient({
      chain: polygon,
      transport: custom(magic.rpcProvider as any),
    });

    const ethersProvider = new providers.Web3Provider(magic.rpcProvider as any);

    setWalletClient(client);
    setEthersSigner(ethersProvider.getSigner());

    magic.user.isLoggedIn().then((isLoggedIn) => {
      if (isLoggedIn) {
        fetchUserAndSync();
      }
    });
  }, []);

  const fetchUserAndSync = useCallback(async () => {
    const magic = getMagic();
    if (!magic) return;
    const userInfo = await magic.user.getInfo();
    const address = (userInfo as any).wallets?.ethereum?.publicAddress;
    setEoaAddress(address ? (address as `0x${string}`) : undefined);

    // Sync to Cognito if we have an email and no valid Cognito token
    const email = (userInfo as any).email;
    if (email && !cognitoAuthClient.isAuthenticated()) {
      await syncMagicToCognito(email);
      refreshFromStorage();
    }
  }, [refreshFromStorage]);

  const connect = useCallback(async () => {
    const magic = getMagic();
    if (!magic) return;
    try {
      await magic.wallet.connectWithUI();
      await fetchUserAndSync();
    } catch (error) {
      console.error("Connect error:", error);
    }
  }, [fetchUserAndSync]);

  const disconnect = useCallback(async () => {
    const magic = getMagic();
    if (!magic) return;
    try {
      await magic.user.logout();
      setEoaAddress(undefined);
      // Clear Cognito tokens on logout
      cognitoAuthClient.signOut();
    } catch (error) {
      console.error("Disconnect error:", error);
    }
  }, []);

  const value = useMemo<WalletContextType>(
    () => ({
      magic: getMagic(),
      eoaAddress,
      walletClient,
      ethersSigner,
      publicClient,
      connect,
      disconnect,
      isConnected: !!eoaAddress,
    }),
    [eoaAddress, walletClient, ethersSigner, connect, disconnect]
  );

  return (
    <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
  );
}
