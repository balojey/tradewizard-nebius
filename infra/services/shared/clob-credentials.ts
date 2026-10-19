/**
 * Shared loader for Polymarket CLOB API credentials.
 *
 * Credentials are stored in a single Secrets Manager secret with shape:
 *   { apiKey, apiSecret, apiPassphrase, apiUrl? }
 *
 * The secret ARN is provided to each portfolio Lambda via the
 * CLOB_CREDENTIALS_SECRET_ARN environment variable. Falls back to discrete
 * env vars (CLOB_API_KEY/SECRET/PASSPHRASE/URL) for local development if no
 * secret is configured.
 *
 * The credentials are cached per Lambda container; the cache is invalidated
 * when the env-derived ARN changes (effectively never within a deploy).
 */

import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';

export interface ClobCredentials {
  apiUrl: string;
  apiKey: string;
  apiSecret: string;
  apiPassphrase: string;
}

const DEFAULT_CLOB_API_URL = 'https://clob.polymarket.com';

const secretsClient = new SecretsManagerClient({});
let cached: ClobCredentials | null = null;
let cachedFor: string | null = null;

/**
 * Resolve CLOB credentials from Secrets Manager (preferred) or env (fallback).
 *
 * Throws only when no credentials are available at all (i.e. Lambda will
 * shortly fail to sign CLOB requests). Callers should guard against missing
 * credentials and fall back to a no-op rather than crashing.
 */
export async function getClobCredentials(): Promise<ClobCredentials> {
  const secretArn = process.env.CLOB_CREDENTIALS_SECRET_ARN;

  if (cached && cachedFor === (secretArn ?? '__env__')) {
    return cached;
  }

  if (secretArn) {
    try {
      const response = await secretsClient.send(
        new GetSecretValueCommand({ SecretId: secretArn })
      );
      if (response.SecretString) {
        const parsed = JSON.parse(response.SecretString) as Partial<ClobCredentials>;
        cached = {
          apiUrl: parsed.apiUrl || process.env.CLOB_API_URL || DEFAULT_CLOB_API_URL,
          apiKey: parsed.apiKey ?? '',
          apiSecret: parsed.apiSecret ?? '',
          apiPassphrase: parsed.apiPassphrase ?? '',
        };
        cachedFor = secretArn;
        return cached;
      }
      console.warn(`CLOB credentials secret ${secretArn} has no string value; falling back to env.`);
    } catch (error) {
      console.warn(`Failed to read CLOB credentials secret ${secretArn}; falling back to env.`, error);
    }
  }

  // Env fallback (local dev / missing-secret scenarios). The handler should
  // log warnings and skip CLOB calls if any of these are blank.
  cached = {
    apiUrl: process.env.CLOB_API_URL || DEFAULT_CLOB_API_URL,
    apiKey: process.env.CLOB_API_KEY || '',
    apiSecret: process.env.CLOB_API_SECRET || '',
    apiPassphrase: process.env.CLOB_API_PASSPHRASE || '',
  };
  cachedFor = '__env__';
  return cached;
}

/**
 * Build the standard set of CLOB request headers.
 * Some Polymarket call sites use POLY-SECRET / POLY-PASSPHRASE while others
 * use POLY-API-SECRET / POLY-API-PASSPHRASE. Both spellings are emitted to
 * keep both call patterns working.
 */
export function buildClobHeaders(creds: ClobCredentials): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'POLY-API-KEY': creds.apiKey,
    'POLY-API-SECRET': creds.apiSecret,
    'POLY-API-PASSPHRASE': creds.apiPassphrase,
    'POLY-SECRET': creds.apiSecret,
    'POLY-PASSPHRASE': creds.apiPassphrase,
  };
}

/**
 * Returns true if all four CLOB credentials are populated. Use as a guard
 * before attempting to place / cancel orders.
 */
export function clobCredentialsConfigured(creds: ClobCredentials): boolean {
  return (
    !!creds.apiUrl &&
    !!creds.apiKey &&
    !!creds.apiSecret &&
    !!creds.apiPassphrase
  );
}
