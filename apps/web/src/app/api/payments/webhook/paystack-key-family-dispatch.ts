import { createHmac, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { primaryWalletCardCheckoutWebhookBoundary } from '@/lib/piggyvest/primary-wallet-card-checkout-webhook-boundary';
import { reconcilePrimaryWalletCardCheckoutWebhook } from '@/lib/piggyvest/primary-wallet-card-checkout-webhook-reconcile';
import { reconcilePrimaryWalletCardCheckoutReversal } from '@/lib/piggyvest/primary-wallet-card-checkout-webhook-reversal';

export interface PaystackKeyMatch {
  legacy: boolean;
  checkout: boolean;
}

/**
 * Match a Paystack webhook signature against the legacy secret and the
 * primary-card checkout secret.
 * @param signature - The signature from the x-paystack-signature header
 * @param payload - The raw request body as string
 * @param env - Environment to read secrets from (defaults to process.env)
 * @returns which key families verified the delivery. The checkout key
 * signs primary-card `charge.success` webhooks when
 * PIGGYVEST_PRIMARY_CARD_PAYSTACK_SECRET differs from the legacy key;
 * without it those deliveries 401 before the card reconcile path and
 * paying customers stay charged-but-uncredited. Callers scope handlers
 * by family: a checkout-only match must never reach legacy handling.
 */
export function matchPaystackWebhookSecrets(
  signature: string | null,
  payload: string,
  env: NodeJS.ProcessEnv = process.env
): PaystackKeyMatch {
  const matched: PaystackKeyMatch = { legacy: false, checkout: false };
  if (!signature) {
    logger.warn({ message: 'Paystack webhook signature missing' });
    return matched;
  }

  const candidates: Array<{
    key: string | undefined;
    family: 'legacy' | 'checkout';
  }> = [
    { key: env.PAYSTACK_SECRET_KEY, family: 'legacy' },
    {
      key: env.PIGGYVEST_PRIMARY_CARD_PAYSTACK_SECRET,
      family: 'checkout',
    },
  ];
  if (!candidates[0]?.key) {
    logger.error({ message: 'PAYSTACK_SECRET_KEY not configured' });
  }
  for (const candidate of candidates) {
    if (!candidate.key) continue;
    try {
      // Generate expected signature using HMAC-SHA512
      const expectedSignature = createHmac('sha512', candidate.key)
        .update(payload)
        .digest('hex');
      if (
        timingSafeHexEqual(String(signature).toLowerCase(), expectedSignature)
      )
        matched[candidate.family] = true;
    } catch (error) {
      logger.error({
        message: 'Paystack webhook signature verification error',
        error,
      });
    }
  }
  return matched;
}

/**
 * Handle a delivery verified solely by the primary-card checkout key.
 * Key-to-handler scoping: the card reconcile path runs exclusively —
 * legacy handlers (merchant wallets, invoices, savings) never see the
 * delivery. Reversals (refunds, disputes) route first to their durable
 * record: they carry the original reference in transaction_reference,
 * which the charge path never reads. A recognizable primary-card event
 * that reconciliation cannot resolve yet (runtime, database, or
 * provider transiently unavailable) returns the retry boundary so
 * Paystack redelivers; only genuinely unrelated events ack without
 * effect.
 */
export async function dispatchPaystackCheckoutOnlyWebhook(
  body: unknown
): Promise<Response> {
  const reversed = await reconcilePrimaryWalletCardCheckoutReversal({ body });
  if (reversed) return reversed;
  const reconciled = await reconcilePrimaryWalletCardCheckoutWebhook({ body });
  if (reconciled) return reconciled;
  return (
    primaryWalletCardCheckoutWebhookBoundary(body) ??
    NextResponse.json({ message: 'Event ignored' })
  );
}

function timingSafeHexEqual(
  providedSignature: string,
  expectedSignature: string
): boolean {
  try {
    const signatureBuffer = Buffer.from(providedSignature, 'hex');
    const expectedBuffer = Buffer.from(expectedSignature, 'hex');
    if (signatureBuffer.length !== expectedBuffer.length) return false;
    return timingSafeEqual(signatureBuffer, expectedBuffer);
  } catch {
    return false;
  }
}
