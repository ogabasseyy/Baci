import 'server-only';

import { createHmac } from 'node:crypto';
import { constantTimeEqual } from '@/lib/constant-time-equal';

export const CHAT_WEBHOOK_TOLERANCE_SECONDS = 300;
const SIGNATURE_PATTERN = /^sha256=([0-9a-f]{64})$/;
const TIMESTAMP_PATTERN = /^\d{9,12}$/;

/**
 * Verifies the messaging service's webhook signature:
 * `X-Chatwoot-Signature: sha256=<hex HMAC-SHA256(secret, "<timestamp>.<raw body>")>`
 * with `X-Chatwoot-Timestamp` in Unix seconds. The exact received bytes are
 * signed, so the caller must pass the raw body, not re-serialized JSON. A
 * timestamp outside the tolerance is refused so a captured request cannot be
 * replayed later. Fails closed on any missing or malformed part.
 */
export function verifyChatWebhookSignature(input: {
  rawBody: string;
  signatureHeader: string | null;
  timestampHeader: string | null;
  secret: string;
  nowSeconds?: number;
}): boolean {
  const signature = input.signatureHeader?.trim().match(SIGNATURE_PATTERN)?.[1];
  const timestamp = input.timestampHeader?.trim();
  if (!signature || !timestamp || !TIMESTAMP_PATTERN.test(timestamp)) {
    return false;
  }
  if (!input.secret) return false;
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(timestamp)) > CHAT_WEBHOOK_TOLERANCE_SECONDS) {
    return false;
  }
  const expected = createHmac('sha256', input.secret)
    .update(`${timestamp}.${input.rawBody}`)
    .digest('hex');
  return constantTimeEqual(expected, signature);
}
