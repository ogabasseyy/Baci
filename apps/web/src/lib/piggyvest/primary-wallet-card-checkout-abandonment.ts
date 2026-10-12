import 'server-only';
import { z } from 'zod';
import { primaryWalletCardCheckoutSchemas as schemas } from '@/schemas/primary-wallet-card-checkout';
import type { createPrimaryWalletCardCheckoutExecutor } from './primary-wallet-card-checkout-executor';
import type { createPrimaryWalletCardCheckoutProvider } from './primary-wallet-card-checkout-provider';

// A ready checkout untouched for 24h is presumed walk-away: Paystack
// hosted checkouts expire long before that, and every status poll or
// webhook touch updates the row. The scan still never abandons blind:
// each candidate is re-verified against the provider and only a
// provider-confirmed dead (or paid, via collection) outcome moves it.
const DEFAULT_STALE_AFTER_MS = 24 * 60 * 60 * 1000;
const MAX_SELECTION = 25;

const staleIntent = schemas.intent.extend({
  expiresAt: z.iso.datetime({ offset: true }),
  callbackUrl: z.string().min(1).max(512),
});

/**
 * Bounded server-side reconciliation for stale ready checkouts. Selects
 * at most `maximum` ready operations older than the cutoff, re-verifies
 * each against the provider, abandons provider-confirmed dead ones
 * (releasing treasury and the unresolved slot), and records collection
 * for provider-confirmed paid ones the client never polled. Pending and
 * reconciliation_required outcomes are left untouched for the
 * client/webhook paths — this scan only moves operations the provider
 * has settled definitively.
 */
export async function runPrimaryCardCheckoutAbandonment(input: {
  settings: unknown;
  execute: ReturnType<typeof createPrimaryWalletCardCheckoutExecutor>;
  provider: ReturnType<typeof createPrimaryWalletCardCheckoutProvider>;
  now?: () => number;
  staleAfterMs?: number;
  maximum?: number;
  signal?: AbortSignal;
}) {
  const settings = schemas.settings.parse(input.settings);
  const timestamp = (input.now ?? Date.now)();
  if (!Number.isFinite(timestamp))
    throw new Error('Primary card clock unavailable');
  const staleAfterMs = input.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  const maximum = input.maximum ?? MAX_SELECTION;
  if (
    !Number.isInteger(staleAfterMs) ||
    staleAfterMs <= 0 ||
    !Number.isInteger(maximum) ||
    maximum < 1 ||
    maximum > MAX_SELECTION
  )
    throw new Error('Primary card abandonment bounds unavailable');
  const totals = { selected: 0, abandoned: 0, collected: 0, skipped: 0 };
  input.signal?.throwIfAborted();
  const selected = z
    .array(staleIntent)
    .max(MAX_SELECTION)
    .parse(
      await input.execute('selectStaleReady', [
        JSON.stringify({
          integrationId: settings.integrationId,
          merchantId: settings.merchantId,
          environment: settings.environment,
          businessId: settings.businessId,
          expiresAt: settings.expiresAt,
          callbackUrl: settings.callbackUrl,
        }),
        new Date(timestamp - staleAfterMs).toISOString(),
        String(maximum),
      ])
    );
  totals.selected = selected.length;
  for (const candidate of selected) {
    input.signal?.throwIfAborted();
    const scope = JSON.stringify({
      environment: candidate.environment,
      integrationId: candidate.integrationId,
      merchantId: candidate.merchantId,
      customerId: candidate.customerId,
      userId: candidate.userId,
      businessId: candidate.businessId,
      email: candidate.email,
      expiresAt: candidate.expiresAt,
      callbackUrl: candidate.callbackUrl,
    });
    const verification = await input.provider.verify(candidate);
    if (verification.outcome === 'abandoned') {
      schemas.acknowledgement.parse(
        await input.execute('abandonment', [scope, candidate.operationId])
      );
      totals.abandoned++;
    } else if (verification.outcome === 'verified') {
      schemas.acknowledgement.parse(
        await input.execute('collection', [
          scope,
          candidate.operationId,
          JSON.stringify(verification.collection),
        ])
      );
      totals.collected++;
    } else totals.skipped++;
  }
  return totals;
}
