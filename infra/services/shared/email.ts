/**
 * Shared transactional email sender.
 *
 * Provider selection (EMAIL_PROVIDER):
 * - "resend" (default): Resend HTTP API
 * - "ses": retained Amazon SES fallback (subject to SES sandbox rules)
 *
 * Resend credentials are read from a Secrets Manager secret (preferred) or
 * from RESEND_API_KEY for local development. The raw key is never injected
 * into Lambda environment variables.
 *
 * Environment variables:
 * - EMAIL_PROVIDER: "resend" | "ses" (optional; defaults to resend when a
 *   Resend key is configured, otherwise ses)
 * - RESEND_API_KEY_SECRET_ARN: Secrets Manager ARN containing {"apiKey": "..."}
 * - RESEND_API_KEY: local-development fallback key
 * - RESEND_FROM_EMAIL: Resend sender (default: notifications@tradewizard.live)
 * - RESEND_REPLY_TO: optional Resend reply-to address
 * - SES_FROM_EMAIL: SES sender used when EMAIL_PROVIDER=ses
 */

import {
  SESv2Client,
  SendEmailCommand,
  type SendEmailCommandInput,
} from '@aws-sdk/client-sesv2';
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';

export type EmailProvider = 'resend' | 'ses';

export interface EmailMessage {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  replyTo?: string;
  /** Stable key so provider retries don't send duplicates (Resend only). */
  idempotencyKey?: string;
}

export interface EmailSendResult {
  provider: EmailProvider;
  messageId?: string;
}

interface NormalizedEmailMessage {
  to: string[];
  subject: string;
  html?: string;
  text?: string;
  replyTo?: string;
  idempotencyKey?: string;
}

const RESEND_API_URL = 'https://api.resend.com/emails';
const DEFAULT_FROM_EMAIL = 'notifications@tradewizard.live';
const RESEND_REQUEST_TIMEOUT_MS = 10_000;
const RESEND_KEY_CACHE_MS = 5 * 60 * 1000;

const sesClient = new SESv2Client({});
const secretsClient = new SecretsManagerClient({});

let cachedResendKey: string | null = null;
let cachedResendKeyFor: string | null = null;
let cachedResendKeyAt = 0;

// ─── Provider Selection ─────────────────────────────────────────────────────────

/**
 * Resolve the active email provider.
 *
 * An explicit EMAIL_PROVIDER always wins. When unset, Resend is selected if a
 * Resend secret/key is configured; otherwise SES is used.
 */
export function resolveEmailProvider(): EmailProvider {
  const raw = (process.env.EMAIL_PROVIDER || '').trim().toLowerCase();

  if (raw === 'resend' || raw === 'ses') {
    return raw;
  }

  if (raw) {
    throw new Error(
      `Unsupported EMAIL_PROVIDER "${raw}". Expected "resend" or "ses".`
    );
  }

  return process.env.RESEND_API_KEY_SECRET_ARN || process.env.RESEND_API_KEY
    ? 'resend'
    : 'ses';
}

// ─── Public API ─────────────────────────────────────────────────────────────────

/**
 * Send a transactional email through the configured provider.
 *
 * Throws on configuration or provider errors so callers can log/record the
 * failure. There is intentionally no silent Resend → SES fallback: switching
 * providers is an explicit deployment decision (EMAIL_PROVIDER=ses).
 */
export async function sendEmail(
  message: EmailMessage
): Promise<EmailSendResult> {
  const normalized = normalizeMessage(message);
  const provider = resolveEmailProvider();

  if (provider === 'resend') {
    return sendViaResend(normalized);
  }

  return sendViaSes(normalized);
}

// ─── Resend ─────────────────────────────────────────────────────────────────────

async function sendViaResend(
  message: NormalizedEmailMessage
): Promise<EmailSendResult> {
  const apiKey = await getResendApiKey();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };

  if (message.idempotencyKey) {
    headers['Idempotency-Key'] = message.idempotencyKey;
  }

  const payload: Record<string, unknown> = {
    from: formatFromAddress(
      process.env.RESEND_FROM_EMAIL || DEFAULT_FROM_EMAIL
    ),
    to: message.to,
    subject: message.subject,
  };

  if (message.html) payload.html = message.html;
  if (message.text) payload.text = message.text;

  const replyTo = message.replyTo || (process.env.RESEND_REPLY_TO || '').trim();
  if (replyTo) payload.reply_to = replyTo;

  let response: Response;
  try {
    response = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(RESEND_REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new Error(
      `Resend request failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  const responseBody = await response.text();

  if (!response.ok) {
    throw new Error(
      `Resend send failed (${response.status}): ${extractErrorMessage(responseBody)}`
    );
  }

  return {
    provider: 'resend',
    messageId: extractMessageId(responseBody),
  };
}

async function getResendApiKey(): Promise<string> {
  const secretArn = process.env.RESEND_API_KEY_SECRET_ARN;
  const cacheKey = secretArn || '__env__';
  const now = Date.now();

  if (
    cachedResendKey &&
    cachedResendKeyFor === cacheKey &&
    now - cachedResendKeyAt < RESEND_KEY_CACHE_MS
  ) {
    return cachedResendKey;
  }

  let apiKey = '';

  if (secretArn) {
    try {
      const response = await secretsClient.send(
        new GetSecretValueCommand({ SecretId: secretArn })
      );
      apiKey = extractApiKey(response.SecretString);
    } catch (error) {
      console.warn(
        `Failed to read Resend API key from ${secretArn}; falling back to RESEND_API_KEY.`,
        error
      );
    }
  }

  if (!apiKey) {
    apiKey = (process.env.RESEND_API_KEY || '').trim();
  }

  // Resend API keys are prefixed with re_. This also prevents accidentally
  // using the random placeholder value CDK generates when the secret has not
  // been populated yet.
  if (!apiKey.startsWith('re_')) {
    throw new Error(
      'Resend API key is not configured. Populate the Resend secret or set RESEND_API_KEY.'
    );
  }

  cachedResendKey = apiKey;
  cachedResendKeyFor = cacheKey;
  cachedResendKeyAt = now;

  return apiKey;
}

function extractApiKey(secretString?: string): string {
  const trimmed = (secretString || '').trim();
  if (!trimmed) return '';

  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as {
        apiKey?: string;
        api_key?: string;
      };
      return (parsed.apiKey || parsed.api_key || '').trim();
    } catch {
      return '';
    }
  }

  return trimmed;
}

function extractMessageId(responseBody: string): string | undefined {
  if (!responseBody) return undefined;

  try {
    const parsed = JSON.parse(responseBody) as { id?: string };
    return parsed.id;
  } catch {
    return undefined;
  }
}

function extractErrorMessage(responseBody: string): string {
  if (!responseBody) return 'empty response body';

  try {
    const parsed = JSON.parse(responseBody) as {
      name?: string;
      message?: string;
    };
    const parts = [parsed.name, parsed.message].filter(Boolean);
    if (parts.length > 0) return parts.join(': ');
  } catch {
    // Fall through to the raw body.
  }

  return responseBody.slice(0, 500);
}

// ─── SES (retained fallback) ────────────────────────────────────────────────────

async function sendViaSes(
  message: NormalizedEmailMessage
): Promise<EmailSendResult> {
  const input: SendEmailCommandInput = {
    FromEmailAddress: formatFromAddress(
      process.env.SES_FROM_EMAIL || DEFAULT_FROM_EMAIL
    ),
    Destination: {
      ToAddresses: message.to,
    },
    Content: {
      Simple: {
        Subject: {
          Data: message.subject,
          Charset: 'UTF-8',
        },
        Body: {
          ...(message.html
            ? { Html: { Data: message.html, Charset: 'UTF-8' } }
            : {}),
          ...(message.text
            ? { Text: { Data: message.text, Charset: 'UTF-8' } }
            : {}),
        },
      },
    },
  };

  if (message.replyTo) {
    input.ReplyToAddresses = [message.replyTo];
  }

  const result = await sesClient.send(new SendEmailCommand(input));

  return {
    provider: 'ses',
    messageId: result.MessageId,
  };
}

// ─── Validation / Formatting ────────────────────────────────────────────────────

function normalizeMessage(message: EmailMessage): NormalizedEmailMessage {
  const recipients = (
    Array.isArray(message.to) ? message.to : [message.to]
  )
    .map((value) => value.trim())
    .filter(Boolean);

  if (recipients.length === 0) {
    throw new Error('Email requires at least one recipient.');
  }

  const subject = (message.subject || '').trim();
  if (!subject) {
    throw new Error('Email subject is required.');
  }

  const html = message.html?.trim() || undefined;
  const text = message.text?.trim() || undefined;

  if (!html && !text) {
    throw new Error('Email requires an HTML or text body.');
  }

  const replyTo = message.replyTo?.trim() || undefined;
  const idempotencyKey = normalizeIdempotencyKey(message.idempotencyKey);

  return {
    to: recipients,
    subject,
    html,
    text,
    replyTo,
    idempotencyKey,
  };
}

function normalizeIdempotencyKey(value?: string): string | undefined {
  const trimmed = (value || '').trim();
  if (!trimmed) return undefined;

  if (trimmed.length > 256) {
    throw new Error('Email idempotency key must be 256 characters or fewer.');
  }

  return trimmed;
}

/**
 * Add a friendly display name when the sender is a bare address.
 * Callers can still provide a full "Name <email>" string.
 */
export function formatFromAddress(address: string): string {
  const trimmed = address.trim();
  if (!trimmed) {
    throw new Error('Email sender address is required.');
  }

  return trimmed.includes('<') ? trimmed : `TradeWizard <${trimmed}>`;
}

/** Test helper: clears the per-container Resend key cache. */
export function resetEmailCachesForTests(): void {
  cachedResendKey = null;
  cachedResendKeyFor = null;
  cachedResendKeyAt = 0;
}
