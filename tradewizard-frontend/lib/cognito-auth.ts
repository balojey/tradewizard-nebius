import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  RespondToAuthChallengeCommand,
} from '@aws-sdk/client-cognito-identity-provider';

// --- Interfaces ---

export interface AuthTokens {
  idToken: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export interface CognitoAuthClient {
  initiateAuth(email: string): Promise<{ session: string }>;
  respondToChallenge(
    email: string,
    code: string,
    session: string
  ): Promise<AuthTokens>;
  refreshTokens(refreshToken: string): Promise<AuthTokens>;
  signOut(): void;
  getAccessToken(): string | null;
  getIdToken(): string | null;
  isAuthenticated(): boolean;
  clearTokens(): void;
  getStoredTokens(): AuthTokens | null;
}

// --- Storage keys ---

const STORAGE_PREFIX = 'tw_';
const KEYS = {
  idToken: `${STORAGE_PREFIX}id_token`,
  accessToken: `${STORAGE_PREFIX}access_token`,
  refreshToken: `${STORAGE_PREFIX}refresh_token`,
  expiresAt: `${STORAGE_PREFIX}expires_at`,
} as const;

// --- Factory ---

export function createCognitoAuthClient(config: {
  userPoolId: string;
  clientId: string;
  region: string;
}): CognitoAuthClient {
  const client = new CognitoIdentityProviderClient({
    region: config.region,
  });

  function storeTokens(tokens: AuthTokens): void {
    if (typeof window === 'undefined') return;
    localStorage.setItem(KEYS.idToken, tokens.idToken);
    localStorage.setItem(KEYS.accessToken, tokens.accessToken);
    localStorage.setItem(KEYS.refreshToken, tokens.refreshToken);
    localStorage.setItem(KEYS.expiresAt, String(tokens.expiresAt));
  }

  function clearTokens(): void {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(KEYS.idToken);
    localStorage.removeItem(KEYS.accessToken);
    localStorage.removeItem(KEYS.refreshToken);
    localStorage.removeItem(KEYS.expiresAt);
  }

  function getStoredTokens(): AuthTokens | null {
    if (typeof window === 'undefined') return null;
    const idToken = localStorage.getItem(KEYS.idToken);
    const accessToken = localStorage.getItem(KEYS.accessToken);
    const refreshToken = localStorage.getItem(KEYS.refreshToken);
    const expiresAt = localStorage.getItem(KEYS.expiresAt);

    if (!idToken || !accessToken || !refreshToken || !expiresAt) {
      return null;
    }

    return {
      idToken,
      accessToken,
      refreshToken,
      expiresAt: Number(expiresAt),
    };
  }

  async function initiateAuth(email: string): Promise<{ session: string }> {
    const command = new InitiateAuthCommand({
      AuthFlow: 'CUSTOM_AUTH',
      ClientId: config.clientId,
      AuthParameters: {
        USERNAME: email,
      },
    });

    const response = await client.send(command);

    if (!response.Session) {
      throw new Error('No session returned from InitiateAuth');
    }

    return { session: response.Session };
  }

  async function respondToChallenge(
    email: string,
    code: string,
    session: string
  ): Promise<AuthTokens> {
    const command = new RespondToAuthChallengeCommand({
      ClientId: config.clientId,
      ChallengeName: 'CUSTOM_CHALLENGE',
      Session: session,
      ChallengeResponses: {
        USERNAME: email,
        ANSWER: code,
      },
    });

    const response = await client.send(command);

    if (!response.AuthenticationResult) {
      throw new Error('No authentication result returned from challenge response');
    }

    const { IdToken, AccessToken, RefreshToken, ExpiresIn } =
      response.AuthenticationResult;

    if (!IdToken || !AccessToken || !RefreshToken) {
      throw new Error('Incomplete tokens returned from authentication');
    }

    const tokens: AuthTokens = {
      idToken: IdToken,
      accessToken: AccessToken,
      refreshToken: RefreshToken,
      expiresAt: Date.now() + (ExpiresIn ?? 3600) * 1000,
    };

    storeTokens(tokens);
    return tokens;
  }

  async function refreshTokens(refreshToken: string): Promise<AuthTokens> {
    const command = new InitiateAuthCommand({
      AuthFlow: 'REFRESH_TOKEN_AUTH',
      ClientId: config.clientId,
      AuthParameters: {
        REFRESH_TOKEN: refreshToken,
      },
    });

    const response = await client.send(command);

    if (!response.AuthenticationResult) {
      throw new Error('No authentication result returned from token refresh');
    }

    const { IdToken, AccessToken, ExpiresIn } = response.AuthenticationResult;

    if (!IdToken || !AccessToken) {
      throw new Error('Incomplete tokens returned from refresh');
    }

    // Refresh token auth does not return a new refresh token - keep the existing one
    const tokens: AuthTokens = {
      idToken: IdToken,
      accessToken: AccessToken,
      refreshToken: refreshToken,
      expiresAt: Date.now() + (ExpiresIn ?? 3600) * 1000,
    };

    storeTokens(tokens);
    return tokens;
  }

  function signOut(): void {
    clearTokens();
  }

  function getAccessToken(): string | null {
    const tokens = getStoredTokens();
    if (!tokens) return null;

    // Return null if token has expired
    if (Date.now() >= tokens.expiresAt) {
      return null;
    }

    return tokens.accessToken;
  }

  function getIdToken(): string | null {
    const tokens = getStoredTokens();
    if (!tokens) return null;

    // Return null if token has expired
    if (Date.now() >= tokens.expiresAt) {
      return null;
    }

    return tokens.idToken;
  }

  function isAuthenticated(): boolean {
    const tokens = getStoredTokens();
    if (!tokens) return false;
    return Date.now() < tokens.expiresAt;
  }

  return {
    initiateAuth,
    respondToChallenge,
    refreshTokens,
    signOut,
    getAccessToken,
    getIdToken,
    isAuthenticated,
    clearTokens,
    getStoredTokens,
  };
}

// --- Default instance using environment variables ---

export const cognitoAuthClient = createCognitoAuthClient({
  userPoolId: process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID ?? '',
  clientId: process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID ?? '',
  region: process.env.NEXT_PUBLIC_AWS_REGION ?? 'us-east-1',
});
