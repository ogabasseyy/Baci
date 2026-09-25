import { createHmac } from 'node:crypto';

import { resolveImmediateNotificationCompletionHmacSecret } from './provision-completion-hmac';

/**
 * Server-only completion proof for the proof-bound delivery completion
 * RPC: HMAC-SHA256 over `order_id|claim_token|sent|failed` under the
 * shared completion secret. The payload mirrors the SQL verifier
 * exactly (concat_ws with the same outcome words); the secret is never
 * returned to tracking-token holders, so an anon caller that claims a
 * stale row directly cannot forge a terminal completion. Server-only:
 * throws when the env secret is unconfigured (callers treat that like
 * an RPC failure — completion skipped, never forged).
 */
export function createImmediateNotificationCompletionProof(input: {
  orderId: string;
  claimToken: string;
  sent: boolean;
}): string {
  const payload = [
    input.orderId,
    input.claimToken,
    input.sent ? 'sent' : 'failed',
  ].join('|');
  return createHmac(
    'sha256',
    resolveImmediateNotificationCompletionHmacSecret()
  )
    .update(payload)
    .digest('hex');
}
