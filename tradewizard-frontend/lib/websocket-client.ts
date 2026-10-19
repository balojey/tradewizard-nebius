/**
 * WebSocket client for real-time analysis delivery.
 * Manages connection lifecycle, exponential backoff reconnection,
 * and ping keepalive to prevent idle timeout.
 */

export interface WebSocketMessage {
  type: string;
  payload: {
    analysisId?: string;
    marketId?: string;
    marketQuestion?: string;
    recommendation?: string;
    consensusProbability?: number;
    confidence?: number;
    executedAt?: string;
    // Progress fields
    stage?: number;
    totalStages?: number;
    stageName?: string;
    status?: 'running' | 'completed' | 'failed';
    progress?: number;
    timestamp?: string;
    // Portfolio fields
    sessionId?: string;
    type?: string;
    [key: string]: unknown;
  };
}

export interface WebSocketClientOptions {
  url: string;
  token: string;
  onMessage: (message: WebSocketMessage) => void;
  onConnectionChange: (connected: boolean) => void;
}

const INITIAL_RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_DELAY_MS = 30000;
const PING_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export class WebSocketClient {
  private ws: WebSocket | null = null;
  private options: WebSocketClientOptions;
  private reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private intentionalDisconnect = false;

  constructor(options: WebSocketClientOptions) {
    this.options = options;
  }

  connect(): void {
    this.intentionalDisconnect = false;
    this.reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
    this.establishConnection();
  }

  disconnect(): void {
    this.intentionalDisconnect = true;
    this.cleanup();
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private establishConnection(): void {
    // Clean up any existing connection
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onclose = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      if (
        this.ws.readyState === WebSocket.OPEN ||
        this.ws.readyState === WebSocket.CONNECTING
      ) {
        this.ws.close();
      }
      this.ws = null;
    }

    const url = `${this.options.url}?token=${encodeURIComponent(this.options.token)}`;
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this.reconnectDelay = INITIAL_RECONNECT_DELAY_MS;
      this.options.onConnectionChange(true);
      this.startPingKeepalive();
    };

    this.ws.onclose = () => {
      this.options.onConnectionChange(false);
      this.stopPingKeepalive();

      if (!this.intentionalDisconnect) {
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = () => {
      // The onclose handler will fire after onerror, so reconnection
      // is handled there. Nothing extra needed here.
    };

    this.ws.onmessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data as string);
        // Handle pong responses silently
        if (data.type === "pong") return;

        // Normalize: delivery Lambda sends 'data', progress sends 'payload',
        // portfolio events may embed event data at root level
        const message: WebSocketMessage = {
          type: data.type,
          payload: data.payload || data.data || data,
        };

        if (message.type) {
          this.options.onMessage(message);
        }
      } catch {
        // Ignore malformed messages
      }
    };
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.establishConnection();
    }, this.reconnectDelay);

    // Exponential backoff: 1s, 2s, 4s, 8s, max 30s
    this.reconnectDelay = Math.min(
      this.reconnectDelay * 2,
      MAX_RECONNECT_DELAY_MS
    );
  }

  private startPingKeepalive(): void {
    this.stopPingKeepalive();
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ action: "ping" }));
      }
    }, PING_INTERVAL_MS);
  }

  private stopPingKeepalive(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private cleanup(): void {
    this.stopPingKeepalive();

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onclose = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      if (
        this.ws.readyState === WebSocket.OPEN ||
        this.ws.readyState === WebSocket.CONNECTING
      ) {
        this.ws.close();
      }
      this.ws = null;
    }

    this.options.onConnectionChange(false);
  }
}

export function createWebSocketClient(
  options: WebSocketClientOptions
): WebSocketClient {
  return new WebSocketClient(options);
}
