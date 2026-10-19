"use client";

import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import {
  WebSocketClient,
  type WebSocketMessage,
} from "@/lib/websocket-client";

export interface WebSocketContextValue {
  isConnected: boolean;
  lastMessage: WebSocketMessage | null;
}

export const WebSocketContext = createContext<WebSocketContextValue | null>(
  null
);

interface WebSocketProviderProps {
  children: ReactNode;
}

export function WebSocketProvider({ children }: WebSocketProviderProps) {
  const { isAuthenticated, getAccessToken } = useAuth();
  const queryClient = useQueryClient();
  const [isConnected, setIsConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<WebSocketMessage | null>(null);
  const clientRef = useRef<WebSocketClient | null>(null);

  const handleMessage = useCallback(
    (message: WebSocketMessage) => {
      setLastMessage(message);

      // Invalidate analysis history queries so the list refetches
      if (message.type === 'analysis_complete') {
        queryClient.invalidateQueries({ queryKey: ["analysis-history-paginated"] });
        queryClient.invalidateQueries({ queryKey: ["subscription"] });
      }

      // Portfolio events are handled by usePortfolioWebSocket via lastMessage
      // but we also handle kill switch at provider level for immediate cache busting
      if (message.type === 'portfolio.kill_switch.triggered') {
        queryClient.invalidateQueries({ queryKey: ["portfolio-sessions"] });
        queryClient.invalidateQueries({ queryKey: ["portfolio-stats"] });
      }
    },
    [queryClient]
  );

  const handleConnectionChange = useCallback((connected: boolean) => {
    setIsConnected(connected);
  }, []);

  useEffect(() => {
    if (!isAuthenticated) {
      // Disconnect on logout
      if (clientRef.current) {
        clientRef.current.disconnect();
        clientRef.current = null;
      }
      setIsConnected(false);
      setLastMessage(null);
      return;
    }

    const token = getAccessToken();
    const wsUrl = process.env.NEXT_PUBLIC_WS_URL;

    if (!token || !wsUrl) {
      return;
    }

    // Create and connect the WebSocket client
    const client = new WebSocketClient({
      url: wsUrl,
      token,
      onMessage: handleMessage,
      onConnectionChange: handleConnectionChange,
    });

    clientRef.current = client;
    client.connect();

    return () => {
      client.disconnect();
      clientRef.current = null;
    };
  }, [isAuthenticated, getAccessToken, handleMessage, handleConnectionChange]);

  const value = useMemo<WebSocketContextValue>(
    () => ({ isConnected, lastMessage }),
    [isConnected, lastMessage]
  );

  return (
    <WebSocketContext.Provider value={value}>
      {children}
    </WebSocketContext.Provider>
  );
}
