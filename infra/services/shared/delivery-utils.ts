/**
 * Shared delivery utilities for all notification channels.
 *
 * Provides common logic for:
 * - Quiet hours checking
 * - Probability shift threshold enforcement
 * - Time parsing helpers
 *
 * Used by: analysis-delivery, email-delivery, push-delivery, webhook-delivery
 */

// ─── Quiet Hours ─────────────────────────────────────────────────────────────────

/**
 * Check if the current time falls within the user's configured quiet hours.
 *
 * Quiet hours are specified in HH:MM format (24-hour UTC). Handles overnight
 * ranges (e.g., 22:00 to 07:00) correctly.
 *
 * @param start - Quiet hours start in HH:MM format, or null if not configured
 * @param end - Quiet hours end in HH:MM format, or null if not configured
 * @param overrideQuietHours - If true, bypasses quiet hours (for critical events like kill switch)
 * @returns true if current time is within quiet hours (and not overridden)
 */
export function isWithinQuietHours(
  start: string | null,
  end: string | null,
  overrideQuietHours = false
): boolean {
  if (overrideQuietHours) return false;
  if (!start || !end) return false;

  const now = new Date();
  const currentMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();

  const startMinutes = parseTimeToMinutes(start);
  const endMinutes = parseTimeToMinutes(end);

  if (startMinutes === null || endMinutes === null) return false;
  if (startMinutes === endMinutes) return false;

  // Handle overnight range (e.g., 22:00 to 07:00)
  if (startMinutes > endMinutes) {
    return currentMinutes >= startMinutes || currentMinutes < endMinutes;
  }

  // Normal range (e.g., 01:00 to 06:00)
  return currentMinutes >= startMinutes && currentMinutes < endMinutes;
}

/**
 * Parse a time string in HH:MM format to total minutes since midnight.
 * Returns null if the format is invalid.
 */
export function parseTimeToMinutes(time: string): number | null {
  const match = time.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;

  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);

  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }

  return hours * 60 + minutes;
}

/**
 * Format a TIME value from PostgreSQL to HH:MM string.
 * PostgreSQL TIME can come as "HH:MM:SS" or already as "HH:MM".
 */
export function formatTime(timeValue: string): string {
  const parts = timeValue.toString().split(':');
  return `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}`;
}

// ─── Probability Shift Threshold ─────────────────────────────────────────────────

/**
 * Check if a probability shift exceeds the user's configured minimum threshold.
 *
 * If the user has configured a minProbabilityShift, notifications are only
 * sent when the analysis consensus probability differs from the previous
 * analysis by at least this amount.
 *
 * @param currentProbability - Current analysis consensus probability (0-1)
 * @param previousProbability - Previous analysis consensus probability (0-1), or null if no previous
 * @param minShift - User's configured minimum shift threshold (0.01-1.00), or null if not configured
 * @returns true if the shift is below the threshold (should skip delivery)
 */
export function isBelowProbabilityShiftThreshold(
  currentProbability: number | undefined,
  previousProbability: number | null,
  minShift: number | null
): boolean {
  // No threshold configured → never skip
  if (!minShift || minShift <= 0) return false;

  // No previous probability to compare → don't skip (first delivery for this market)
  if (previousProbability === null || previousProbability === undefined) return false;

  // Current probability missing → don't skip
  if (currentProbability === undefined || currentProbability === null) return false;

  const absoluteShift = Math.abs(currentProbability - previousProbability);
  return absoluteShift < minShift;
}

// ─── Plan Channel Restrictions ───────────────────────────────────────────────────

/** Plans that allow email notifications (Starter and above) */
export const EMAIL_ALLOWED_PLANS: string[] = ['starter', 'pro', 'elite'];

/** Plans that allow push notifications (Starter and above) */
export const PUSH_ALLOWED_PLANS: string[] = ['starter', 'pro', 'elite'];

/** Plans that allow webhook notifications (Pro and above) */
export const WEBHOOK_ALLOWED_PLANS: string[] = ['pro', 'elite'];

// ─── Market Slug Resolution ──────────────────────────────────────────────────────

const CLOB_API_URL = 'https://clob.polymarket.com';

/**
 * Resolve a condition_id to a market_slug via the Polymarket CLOB API.
 * Returns the slug if found, otherwise falls back to the condition_id.
 * The frontend's /markets/[slug] page handles both slugs and condition_ids,
 * but slugs produce cleaner URLs.
 */
export async function resolveMarketSlug(conditionId: string): Promise<string> {
  try {
    const response = await fetch(`${CLOB_API_URL}/markets/${conditionId}`, {
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(5000), // 5s timeout - don't delay delivery
    });

    if (!response.ok) return conditionId;

    const market = await response.json() as { market_slug?: string };
    return market?.market_slug || conditionId;
  } catch {
    // On any failure, fall back to condition_id (the page handles it)
    return conditionId;
  }
}
