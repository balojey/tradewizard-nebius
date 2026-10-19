"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  createCognitoAuthClient,
  type AuthTokens,
  type CognitoAuthClient,
} from "@/lib/cognito-auth";

export interface AuthUser {
  email: string;
  sub: string;
}

export interface AuthContextValue {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  signIn: (email: string) => Promise<void>;
  verifyCode: (code: string) => Promise<void>;
  signOut: () => void;
  getAccessToken: () => string | null;
  refreshFromStorage: () => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

// Parse JWT payload without external dependencies
function parseJwtPayload(token: string): Record<string, unknown> {
  try {
    const base64Url = token.split(".")[1];
    const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split("")
        .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
        .join("")
    );
    return JSON.parse(jsonPayload);
  } catch {
    return {};
  }
}

// --- Auth Cookie Bridge ---
// Mirrors the id token into a non-HttpOnly cookie so Next.js middleware can
// read auth state at the edge for routing decisions.

const AUTH_COOKIE_NAME = "tw_id_token";

function setIdTokenCookie(idToken: string): void {
  if (typeof document === "undefined") return;
  const payload = parseJwtPayload(idToken);
  const exp = payload.exp as number | undefined;
  // Compute Max-Age from the JWT exp claim; fall back to 1 hour
  const maxAge =
    exp != null ? Math.max(exp - Math.floor(Date.now() / 1000), 0) : 3600;
  document.cookie = `${AUTH_COOKIE_NAME}=${idToken}; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

function clearIdTokenCookie(): void {
  if (typeof document === "undefined") return;
  document.cookie = `${AUTH_COOKIE_NAME}=; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

function extractUserFromTokens(tokens: AuthTokens): AuthUser | null {
  const payload = parseJwtPayload(tokens.idToken);
  const email = payload.email as string | undefined;
  const sub = payload.sub as string | undefined;

  if (!email || !sub) return null;
  return { email, sub };
}

// Refresh tokens 5 minutes before expiry
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [pendingSession, setPendingSession] = useState<string | null>(null);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);

  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clientRef = useRef<CognitoAuthClient | null>(null);

  // Initialize the Cognito client once
  const getClient = useCallback((): CognitoAuthClient => {
    if (!clientRef.current) {
      clientRef.current = createCognitoAuthClient({
        userPoolId: process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID ?? "",
        clientId: process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID ?? "",
        region: process.env.NEXT_PUBLIC_COGNITO_REGION ?? "us-east-1",
      });
    }
    return clientRef.current;
  }, []);

  // Schedule token refresh before expiry
  const scheduleRefresh = useCallback(
    (tokens: AuthTokens) => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
      }

      const timeUntilExpiry = tokens.expiresAt - Date.now();
      const refreshIn = Math.max(timeUntilExpiry - REFRESH_BUFFER_MS, 0);

      refreshTimerRef.current = setTimeout(async () => {
        const client = getClient();
        try {
          const newTokens = await client.refreshTokens(tokens.refreshToken);
          const newUser = extractUserFromTokens(newTokens);
          if (newUser) {
            setUser(newUser);
            setIdTokenCookie(newTokens.idToken);
            scheduleRefresh(newTokens);
          } else {
            // Token refresh succeeded but user extraction failed - sign out
            client.clearTokens();
            clearIdTokenCookie();
            setUser(null);
            window.location.href = "/login";
          }
        } catch {
          // Refresh failed - clear state and redirect to login
          client.clearTokens();
          clearIdTokenCookie();
          setUser(null);
          window.location.href = "/login";
        }
      }, refreshIn);
    },
    [getClient]
  );

  // Check for existing tokens on mount
  useEffect(() => {
    const client = getClient();
    const tokens = client.getStoredTokens();

    if (!tokens) {
      setIsLoading(false);
      return;
    }

    // If tokens are expired, try to refresh
    if (tokens.expiresAt <= Date.now()) {
      client
        .refreshTokens(tokens.refreshToken)
        .then((newTokens) => {
          const extractedUser = extractUserFromTokens(newTokens);
          if (extractedUser) {
            setUser(extractedUser);
            setIdTokenCookie(newTokens.idToken);
            scheduleRefresh(newTokens);
          } else {
            client.clearTokens();
            clearIdTokenCookie();
          }
        })
        .catch(() => {
          client.clearTokens();
          clearIdTokenCookie();
        })
        .finally(() => {
          setIsLoading(false);
        });
    } else {
      // Tokens are still valid
      const extractedUser = extractUserFromTokens(tokens);
      if (extractedUser) {
        setUser(extractedUser);
        setIdTokenCookie(tokens.idToken);
        scheduleRefresh(tokens);
      } else {
        client.clearTokens();
        clearIdTokenCookie();
      }
      setIsLoading(false);
    }

    return () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
      }
    };
  }, [getClient, scheduleRefresh]);

  const signIn = useCallback(
    async (email: string) => {
      const client = getClient();
      const { session } = await client.initiateAuth(email);
      setPendingSession(session);
      setPendingEmail(email);
    },
    [getClient]
  );

  const verifyCode = useCallback(
    async (code: string) => {
      if (!pendingSession || !pendingEmail) {
        throw new Error(
          "No pending auth session. Call signIn first."
        );
      }

      const client = getClient();
      const tokens = await client.respondToChallenge(
        pendingEmail,
        code,
        pendingSession
      );

      const extractedUser = extractUserFromTokens(tokens);
      if (!extractedUser) {
        throw new Error("Failed to extract user from tokens");
      }

      setUser(extractedUser);
      setIdTokenCookie(tokens.idToken);
      scheduleRefresh(tokens);
      setPendingSession(null);
      setPendingEmail(null);
    },
    [getClient, pendingSession, pendingEmail, scheduleRefresh]
  );

  const signOut = useCallback(() => {
    const client = getClient();
    client.signOut();
    clearIdTokenCookie();
    setUser(null);
    setPendingSession(null);
    setPendingEmail(null);

    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }

    pendo.clearSession();
  }, [getClient]);

  const getAccessToken = useCallback((): string | null => {
    const client = getClient();
    const tokens = client.getStoredTokens();
    if (!tokens) return null;

    // If token is expired, return null (refresh will happen via scheduled timer)
    if (tokens.expiresAt <= Date.now()) return null;

    return tokens.accessToken;
  }, [getClient]);

  // Re-read tokens from localStorage (called after Magic→Cognito sync writes tokens)
  const refreshFromStorage = useCallback(() => {
    const client = getClient();
    const tokens = client.getStoredTokens();
    if (!tokens || tokens.expiresAt <= Date.now()) return;

    const extractedUser = extractUserFromTokens(tokens);
    if (extractedUser) {
      setUser(extractedUser);
      setIdTokenCookie(tokens.idToken);
      scheduleRefresh(tokens);
    }
  }, [getClient, scheduleRefresh]);

  // Listen for storage changes (e.g., WalletProvider writing Cognito tokens)
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'tw_id_token' && e.newValue) {
        refreshFromStorage();
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [refreshFromStorage]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isAuthenticated: user !== null,
      isLoading,
      signIn,
      verifyCode,
      signOut,
      getAccessToken,
      refreshFromStorage,
    }),
    [user, isLoading, signIn, verifyCode, signOut, getAccessToken, refreshFromStorage]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuthContext(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuthContext must be used within an AuthProvider");
  }
  return context;
}
