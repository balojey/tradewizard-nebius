import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));

vi.mock('@aws-sdk/client-sesv2', () => ({
  SESv2Client: vi.fn(() => ({ send: sendMock })),
  SendEmailCommand: vi.fn((input: unknown) => ({ input })),
}));

import {
  resetEmailCachesForTests,
  resolveEmailProvider,
  sendEmail,
} from './email';

const ORIGINAL_ENV = { ...process.env };

function resetProviderEnv(): void {
  delete process.env.EMAIL_PROVIDER;
  delete process.env.RESEND_API_KEY;
  delete process.env.RESEND_API_KEY_SECRET_ARN;
  delete process.env.RESEND_FROM_EMAIL;
  delete process.env.RESEND_REPLY_TO;
  delete process.env.SES_FROM_EMAIL;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...ORIGINAL_ENV };
  resetProviderEnv();
  sendMock.mockReset();
  resetEmailCachesForTests();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.unstubAllGlobals();
});

describe('resolveEmailProvider', () => {
  it('honors an explicit provider (case-insensitive)', () => {
    process.env.EMAIL_PROVIDER = 'SES';
    expect(resolveEmailProvider()).toBe('ses');

    process.env.EMAIL_PROVIDER = 'resend';
    expect(resolveEmailProvider()).toBe('resend');
  });

  it('selects Resend when a key is configured without an explicit provider', () => {
    process.env.RESEND_API_KEY = 're_test';
    expect(resolveEmailProvider()).toBe('resend');
  });

  it('falls back to SES when no Resend configuration exists', () => {
    expect(resolveEmailProvider()).toBe('ses');
  });

  it('throws on an unsupported provider', () => {
    process.env.EMAIL_PROVIDER = 'mailgun';
    expect(() => resolveEmailProvider()).toThrow(/Unsupported EMAIL_PROVIDER/);
  });
});

describe('sendEmail (Resend)', () => {
  beforeEach(() => {
    process.env.EMAIL_PROVIDER = 'resend';
    process.env.RESEND_API_KEY = 're_test_key';
    process.env.RESEND_FROM_EMAIL = 'notifications@example.com';
  });

  it('sends the expected payload and returns the provider message id', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 'email_123' }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await sendEmail({
      to: 'user@example.com',
      subject: 'Hello',
      html: '<p>Hello</p>',
      text: 'Hello',
      replyTo: 'support@example.com',
      idempotencyKey: 'analysis-email/result-1/user-1',
    });

    expect(result).toEqual({ provider: 'resend', messageId: 'email_123' });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.method).toBe('POST');

    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer re_test_key');
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers['Idempotency-Key']).toBe('analysis-email/result-1/user-1');

    const body = JSON.parse(String(init.body));
    expect(body).toEqual({
      from: 'TradeWizard <notifications@example.com>',
      to: ['user@example.com'],
      subject: 'Hello',
      html: '<p>Hello</p>',
      text: 'Hello',
      reply_to: 'support@example.com',
    });
  });

  it('supports multiple recipients and omits the idempotency header when absent', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 'email_multi' }));
    vi.stubGlobal('fetch', fetchMock);

    await sendEmail({
      to: ['a@example.com', 'b@example.com'],
      subject: 'Hello',
      text: 'Hi',
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['Idempotency-Key']).toBeUndefined();

    const body = JSON.parse(String(init.body));
    expect(body.to).toEqual(['a@example.com', 'b@example.com']);
  });

  it('throws an actionable error on a non-2xx response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(
          { name: 'validation_error', message: 'The domain is not verified' },
          403
        )
      )
    );

    await expect(
      sendEmail({ to: 'user@example.com', subject: 'Hi', text: 'Hi' })
    ).rejects.toThrow(/Resend send failed \(403\): validation_error: The domain is not verified/);
  });

  it('throws when no Resend key is configured', async () => {
    delete process.env.RESEND_API_KEY;

    await expect(
      sendEmail({ to: 'user@example.com', subject: 'Hi', text: 'Hi' })
    ).rejects.toThrow(/Resend API key is not configured/);
  });

  it('rejects a non-Resend placeholder value (e.g. an unpopulated CDK secret)', async () => {
    process.env.RESEND_API_KEY = 'cdk-generated-placeholder';

    await expect(
      sendEmail({ to: 'user@example.com', subject: 'Hi', text: 'Hi' })
    ).rejects.toThrow(/Resend API key is not configured/);
  });

  it('validates recipients, subject, and body', async () => {
    await expect(
      sendEmail({ to: '  ', subject: 'Hi', text: 'Hi' })
    ).rejects.toThrow(/at least one recipient/);

    await expect(
      sendEmail({ to: 'user@example.com', subject: '  ', text: 'Hi' })
    ).rejects.toThrow(/subject is required/);

    await expect(
      sendEmail({ to: 'user@example.com', subject: 'Hi' })
    ).rejects.toThrow(/HTML or text body/);
  });
});

describe('sendEmail (SES retained fallback)', () => {
  beforeEach(() => {
    process.env.EMAIL_PROVIDER = 'ses';
    process.env.SES_FROM_EMAIL = 'notifications@example.com';
    sendMock.mockResolvedValue({ MessageId: 'ses_message_1' });
  });

  it('routes through SES when explicitly configured', async () => {
    const result = await sendEmail({
      to: 'user@example.com',
      subject: 'Hello',
      text: 'Hello',
    });

    expect(result).toEqual({ provider: 'ses', messageId: 'ses_message_1' });
    expect(sendMock).toHaveBeenCalledTimes(1);

    const command = sendMock.mock.calls[0][0] as { input: Record<string, unknown> };
    expect(command.input).toMatchObject({
      FromEmailAddress: 'TradeWizard <notifications@example.com>',
      Destination: { ToAddresses: ['user@example.com'] },
    });
  });
});
