import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import type { GatewayPaymentTransaction } from './gateway-payment-transaction';
import { listPaystackRefunds } from './list-paystack-refunds';
import { normalizeRefundMoneyField } from './normalize-refund-money-field';
import type { CancellationOrder } from './order-cancellation-side-effect-types';
import { quarantineRefund } from './quarantine-order-cancellation-refund';
import { DeferredError } from './run-order-cancellation-side-effect';

/**
 * A provider refund consumed by a manual pairing, with the kobo
 * amount it paired against. The proof stamp matches rows to ids by
 * amount (multiset consume), never by position: provider listings
 * need not arrive in ledger order, so parallel arrays would
 * cross-assign ids when amounts differ per row.
 */
export interface PairedProviderRefund {
  // Decimal text, matching the lister: a numeric id above 2^53
  // would already be rounded.
  providerRefundId: string;
  kobo: number;
}

// Provider IDs persist as decimal text, but stamps written before
// the text migration hold JSON numbers: normalize both to exact
// decimal text so old stamps keep reserving their rows.
function providerRefundIdText(value: unknown): string | null {
  if (typeof value === 'string' && /^[1-9][0-9]*$/.test(value)) return value;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0)
    return String(value);
  return null;
}

export async function checkCancellationRefundProvider({
  reference,
  currency,
  knownRefunds,
  deadlineMs,
  order,
  supabase,
  transaction,
}: {
  reference: string;
  currency: string;
  knownRefunds: Array<{
    gateway_reference?: string | null;
    status: string;
    amount: number;
    currency?: string | null;
    metadata?: Record<string, unknown> | null;
  }>;
  deadlineMs?: number;
  order: CancellationOrder;
  supabase: Pick<SupabaseClient, 'from' | 'rpc'>;
  transaction: GatewayPaymentTransaction;
}): Promise<PairedProviderRefund[]> {
  // Every finding here files a reconciliation review before
  // terminalizing: a bare DeliveryUncertainError would strand the step
  // as delivery_uncertain with no row for operations to resolve.
  const quarantine = (
    reason: string,
    metadata: Record<string, unknown> = {}
  ): Promise<never> =>
    quarantineRefund({
      metadata: {
        provider: 'paystack',
        provider_reference: reference,
        failed_payment_transaction_id: transaction.id,
        payment_transaction_id: transaction.id,
        ...metadata,
      },
      order,
      preflight: true,
      reason,
      supabase,
      transactions: [transaction],
    });
  let rows: Awaited<ReturnType<typeof listPaystackRefunds>>;
  try {
    rows = await listPaystackRefunds(reference, { deadlineMs });
  } catch (error) {
    // Fail closed, but log the cause: a config outage (missing
    // secret) strands every Paystack leg and needs an ops alert,
    // not silent reconciliation backlog.
    logger.error({
      error,
      message: 'Cancellation refund provider verification failed',
      reference,
    });
    // Budget exhaustion is not provider evidence: a timed-out page
    // says nothing about the money, so defer with a fresh budget
    // instead of terminalizing a clean refund into reconciliation.
    if (
      (error as { name?: unknown } | null)?.name === 'TimeoutError' ||
      (error as { name?: unknown } | null)?.name === 'AbortError'
    ) {
      throw new DeferredError(
        'cancellation_refund_provider_verification_deferred_for_budget'
      );
    }
    return quarantine(
      'Unable to verify existing Paystack refunds; review required'
    );
  }
  // A fungible amount pool cannot attribute which provider refund a
  // manual row refers to, so coverage requires an exact single-row
  // correspondence: each unmatched processed row must pair with exactly
  // one same-currency manual row of the identical amount. Anything else
  // quarantines for review. Manual rows always pair from the pool —
  // even when the merchant entered the numeric provider ID as the
  // reference (legacy rows carry it bare in gateway_reference): only
  // the persisted stamp proves verification, so excluding
  // reference-matching manuals would leave them permanently pending
  // with no pair and no quarantine. Native ledger rows match by
  // reference in the rows loop instead and never enter the pool.
  // IDs already persisted onto stamped rows are reserved before
  // pairing: the proof stamp skips stamped rows, so pairing their
  // ids to unstamped claims would cross-assign the old id to a new
  // row (listing order is not guaranteed) while the new provider
  // refund stays unlinked. Stamped rows prove themselves; only
  // unstamped claims consume fresh pairs. A stamp whose id the
  // listing no longer carries is the sweep's contradiction recheck,
  // not this preflight's, so absence quarantines nothing here.
  const reservedProviderIds = new Set<string>();
  for (const item of knownRefunds) {
    // Same filters as the candidate loop below: a corrupt stamp on a
    // foreign-currency or non-Paystack row reserves nothing, so its id
    // still pairs-or-quarantines instead of passing silently.
    if (
      (item.status === 'completed' || item.status === 'refunded') &&
      item.metadata?.method === 'paystack' &&
      normalizeRefundMoneyField(item.currency) ===
        normalizeRefundMoneyField(currency) &&
      item.metadata?.provider_refund_status === 'processed'
    ) {
      const stored = providerRefundIdText(item.metadata?.provider_refund_id);
      if (stored !== null) {
        reservedProviderIds.add(stored);
      }
    }
  }
  const manualCandidates: number[] = [];
  // Provider refunds consumed by manual pairings, returned so the
  // proof stamp can persist the paired id onto the matching row:
  // the finalized-contradiction sweep rechecks stamped manuals by
  // stored provider id (their merchant reference is not a provider
  // id). Each pair carries the kobo amount it consumed so the stamp
  // assigns by amount, not by listing position.
  const pairedProviderRefunds: PairedProviderRefund[] = [];
  for (const item of knownRefunds) {
    // Both terminal statuses count, matching the preflight
    // verification set and the proof stamp: a legacy refunded-status
    // manual claim must pair with provider evidence like a completed
    // one, or an empty provider listing would verify it into
    // coverage with no money behind it.
    if (item.status !== 'completed' && item.status !== 'refunded') continue;
    if (item.metadata?.method !== 'paystack') continue;
    if (
      normalizeRefundMoneyField(item.currency) !==
      normalizeRefundMoneyField(currency)
    )
      continue;
    // Already stamped: its proof is persisted, so it must neither
    // consume a fresh pair nor demand one from the listing.
    if (
      item.metadata?.provider_refund_status === 'processed' &&
      reservedProviderIds.has(
        providerRefundIdText(item.metadata?.provider_refund_id) ?? ''
      )
    )
      continue;
    const kobo = Math.round(Number(item.amount) * 100);
    if (!Number.isSafeInteger(kobo) || kobo <= 0) continue;
    manualCandidates.push(kobo);
  }
  for (const row of rows) {
    // Failed provider rows moved no money, so they skip both the
    // amount/currency gate and the pairing below: a failed row must never
    // strand the refund behind review.
    if (row.status === 'failed') continue;
    // Reserved by an existing stamp: already linked, nothing to prove.
    if (row.status === 'processed' && reservedProviderIds.has(row.id)) {
      reservedProviderIds.delete(row.id);
      continue;
    }
    const known = knownRefunds.find(
      (item) => (item.gateway_reference ?? '').trim() === String(row.id)
    );
    if (
      normalizeRefundMoneyField(row.currency) !==
        normalizeRefundMoneyField(currency) ||
      (known && Math.round(Number(known.amount) * 100) !== row.amount)
    )
      return quarantine('Paystack refund amount or currency mismatch', {
        provider_refund_id: row.id,
      });
    // Native ledger rows match by reference: their ledger presence is
    // the proof, so the provider row needs no pair. Manual rows never
    // shortcut here even on a reference match (legacy rows can carry
    // the bare provider ID): only a persisted stamp proves a manual
    // claim, so they fall through to pairing below.
    if (
      (known?.status === 'completed' || known?.status === 'refunded') &&
      known?.metadata?.method == null &&
      row.status === 'processed'
    )
      continue;
    if (row.status === 'processed') {
      const pair = manualCandidates.indexOf(row.amount);
      if (pair !== -1) {
        manualCandidates.splice(pair, 1);
        pairedProviderRefunds.push({
          kobo: row.amount,
          providerRefundId: row.id,
        });
        continue;
      }
    }
    return quarantine(
      'An existing Paystack refund requires reconciliation before retry',
      { provider_refund_id: row.id, provider_refund_status: row.status }
    );
  }
  // An unpaired manual candidate means the merchant claimed Paystack money
  // the provider does not confirm. That is either a mis-recorded method or
  // money that never moved — quarantine for review instead of passing.
  if (manualCandidates.length > 0)
    return quarantine(
      'Manual Paystack refunds exceed provider-confirmed amounts; review required',
      { unpaired_manual_kobo: manualCandidates }
    );
  return pairedProviderRefunds;
}
