"use client";

import { useContext } from "react";
import { WebSocketContext } from "@/providers/WebSocketProvider";
import type { WebSocketMessage } from "@/lib/websocket-client";

export interface UseWebSocketReturn {
  isConnected: boolean;
  lastMessage: WebSocketMessage | null;
}

export function useWebSocket(): UseWebSocketReturn {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error("useWebSocket must be used within a WebSocketProvider");
  }
  return context;
}
