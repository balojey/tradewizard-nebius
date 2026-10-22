import { cognitoAuthClient } from './cognito-auth';

// --- Error Classes ---

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly statusText: string,
    public readonly body?: unknown
  ) {
    super(`API Error ${status}: ${statusText}`);
    this.name = 'ApiError';
  }
}

export class InsufficientCreditsError extends ApiError {
  constructor(body?: unknown) {
    super(402, 'Insufficient Credits', body);
    this.name = 'InsufficientCreditsError';
  }
}

export class PlanRestrictionError extends ApiError {
  constructor(body?: unknown) {
    super(403, 'Plan Restriction', body);
    this.name = 'PlanRestrictionError';
  }
}

export class NotFoundError extends ApiError {
  constructor(body?: unknown) {
    super(404, 'Not Found', body);
    this.name = 'NotFoundError';
  }
}

// --- Retry Configuration ---

const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 2000, 4000]; // 1s, 2s, 4s

// --- Helpers ---

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status: number): boolean {
  return status >= 500;
}

function buildHeaders(method: string): Record<string, string> {
  const headers: Record<string, string> = {};

  // Cognito User Pools Authorizer validates ID tokens, not access tokens
  const token = cognitoAuthClient.getIdToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  if (method === 'POST' || method === 'PUT') {
    headers['Content-Type'] = 'application/json';
  }

  return headers;
}

function buildUrl(baseUrl: string, path: string, params?: Record<string, string>): string {
  // Ensure baseUrl doesn't end with slash and path starts with slash
  const base = baseUrl.replace(/\/+$/, '');
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  const fullUrl = `${base}${cleanPath}`;

  if (params && Object.keys(params).length > 0) {
    const url = new URL(fullUrl);
    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.set(key, value);
    });
    return url.toString();
  }

  return fullUrl;
}

async function parseErrorBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function clearAuthAndRedirect(): void {
  // Clear localStorage tokens
  cognitoAuthClient.clearTokens();
  // Clear the tw_id_token cookie used by middleware
  if (typeof document !== 'undefined') {
    document.cookie = 'tw_id_token=; Secure; SameSite=Lax; Path=/; Max-Age=0';
  }
  // Redirect to login (but not if already on /login to avoid infinite loops)
  if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
    window.location.href = '/login';
  }
}

function throwTypedError(status: number, statusText: string, body?: unknown): never {
  switch (status) {
    case 401:
      clearAuthAndRedirect();
      // Throw after initiating redirect so the call stack unwinds cleanly
      throw new ApiError(401, 'Unauthorized', body);
    case 402:
      throw new InsufficientCreditsError(body);
    case 403:
      throw new PlanRestrictionError(body);
    case 404:
      throw new NotFoundError(body);
    default:
      throw new ApiError(status, statusText, body);
  }
}

// --- Core Request Function ---

async function request<T>(
  method: string,
  path: string,
  options?: { body?: unknown; params?: Record<string, string> }
): Promise<T> {
  const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';
  const url = buildUrl(baseUrl, path, options?.params);
  const headers = buildHeaders(method);

  const fetchOptions: RequestInit = {
    method,
    headers,
  };

  if (options?.body !== undefined && (method === 'POST' || method === 'PUT')) {
    fetchOptions.body = JSON.stringify(options.body);
  }

  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, fetchOptions);

      if (response.ok) {
        // Handle 204 No Content
        if (response.status === 204) {
          return undefined as T;
        }
        return (await response.json()) as T;
      }

      // Non-retryable client errors - throw immediately
      if (!isRetryableStatus(response.status)) {
        const body = await parseErrorBody(response);
        throwTypedError(response.status, response.statusText, body);
      }

      // Retryable 5xx error
      lastError = new ApiError(response.status, response.statusText);

      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_DELAYS[attempt]);
      }
    } catch (error) {
      // Re-throw typed API errors (non-retryable)
      if (error instanceof ApiError) {
        throw error;
      }

      // Network errors are retryable
      lastError = error;

      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_DELAYS[attempt]);
      }
    }
  }

  // All retries exhausted
  if (lastError instanceof Error) {
    throw lastError;
  }
  throw new ApiError(500, 'Request failed after retries');
}

// --- Typed HTTP Methods ---

export function get<T>(path: string, params?: Record<string, string>): Promise<T> {
  return request<T>('GET', path, { params });
}

export function post<T>(path: string, body?: unknown): Promise<T> {
  return request<T>('POST', path, { body });
}

export function put<T>(path: string, body?: unknown): Promise<T> {
  return request<T>('PUT', path, { body });
}

export function del<T>(path: string): Promise<T> {
  return request<T>('DELETE', path);
}

// --- ApiClient Interface & Singleton ---

export interface ApiClient {
  get<T>(path: string, params?: Record<string, string>): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  put<T>(path: string, body?: unknown): Promise<T>;
  delete<T>(path: string): Promise<T>;
}

export function createApiClient(_config: {
  baseUrl: string;
  getToken: () => string | null;
}): ApiClient {
  return {
    get<T>(path: string, params?: Record<string, string>): Promise<T> {
      return request<T>('GET', path, { params });
    },
    post<T>(path: string, body?: unknown): Promise<T> {
      return request<T>('POST', path, { body });
    },
    put<T>(path: string, body?: unknown): Promise<T> {
      return request<T>('PUT', path, { body });
    },
    delete<T>(path: string): Promise<T> {
      return request<T>('DELETE', path);
    },
  };
}

export const apiClient: ApiClient = createApiClient({
  baseUrl: process.env.NEXT_PUBLIC_API_BASE_URL ?? '',
  getToken: () => cognitoAuthClient.getAccessToken(),
});
