"use client";

import { ReactNode } from "react";
import { AuthProvider } from "./AuthProvider";
import QueryProvider from "./QueryProvider";
import { WebSocketProvider } from "./WebSocketProvider";
import { WalletProvider } from "./WalletProvider";
import TradingProvider from "./TradingProvider";
import { PendoInitializer } from "@/components/PendoInitializer";

export default function Providers({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <WalletProvider>
        <QueryProvider>
          <WebSocketProvider>
            <TradingProvider>
              <PendoInitializer />
              {children}
            </TradingProvider>
          </WebSocketProvider>
        </QueryProvider>
      </WalletProvider>
    </AuthProvider>
  );
}
