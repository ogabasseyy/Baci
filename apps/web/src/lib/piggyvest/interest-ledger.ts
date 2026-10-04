import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import z from 'zod';
import type { InterestPayoutSuccessEvent } from '@/schemas/piggyvest/events';
import { resolvePlanWalletMapping } from './plan-wallet-mapping';

/**
 * Verified interest-payout ledger.
 *
 * Money-flow rules enforced here:
 * - One row per provider payout identity (`eventData.id`). Redeliveries —
 *   even across distinct event_ids — collapse on that key and can never
 *   double-credit.
 * - Arithmetic is verified before credit: gross − tax must equal net, and
 *   the envelope amount must equal net. A violation fails closed as
 *   poison (ack-without-credit), never as a partial or adjusted credit.
 *   The table's CHECK constraints backstop the app check.
 * - No credit is written unless the event's provider (customer, wallet)
 *   pair resolves to a known plan-wallet mapping. Unmapped payouts fail
 *   retryable (INTEREST_LEDGER_UNMAPPED): attribution, not arithmetic, is
 *   what is missing, and a later mapping must still be able to credit.
 * - Only reconciled net payouts are credited. Pending accrual is never
 *   spendable and is never written here.
 */

export type RecordInterestPayoutOutcome = 'credited' | 'duplicate';

export class InterestLedgerError extends Error {
  readonly code:
    | 'INTEREST_LEDGER_INCONSISTENT'
    | 'INTEREST_LEDGER_UNMAPPED'
    | 'INTEREST_LEDGER_STORAGE_ERROR';

  constructor(code: InterestLedgerError['code'], message: string) {
    super(message);
    this.name = 'InterestLedgerError';
    this.code = code;
  }
}

const netKoboRowSchema = z.object({ net_kobo: z.int().nonnegative() });

export async function recordInterestPayout(
  supabase: SupabaseClient,
  event: InterestPayoutSuccessEvent
): Promise<RecordInterestPayoutOutcome> {
  const detail = event.eventData;
  const { gross_interest_payout, withholding_tax, net_interest_payout } =
    detail.break_down;
  if (
    gross_interest_payout - withholding_tax !== net_interest_payout ||
    detail.amount !== net_interest_payout
  ) {
    throw new InterestLedgerError(
      'INTEREST_LEDGER_INCONSISTENT',
      'Interest payout arithmetic is inconsistent'
    );
  }

  const mapping = await resolvePlanWalletMapping(supabase, {
    piggyvestCustomerId: event.customer_id,
    walletId: event.pvb_wallet,
  }).catch((error: unknown) => {
    throw new InterestLedgerError(
      'INTEREST_LEDGER_STORAGE_ERROR',
      error instanceof Error ? error.message : 'Mapping lookup failed'
    );
  });
  if (!mapping) {
    throw new InterestLedgerError(
      'INTEREST_LEDGER_UNMAPPED',
      'Interest wallet has no verified plan-wallet mapping'
    );
  }

  const { data: inserted, error } = await supabase
    .from('piggyvest_interest_payouts')
    .upsert(
      {
        provider_payout_id: detail.id,
        event_id: event.eventId,
        customer_id: event.customer_id,
        wallet_id: event.pvb_wallet,
        amount_kobo: detail.amount,
        gross_kobo: gross_interest_payout,
        withholding_tax_kobo: withholding_tax,
        net_kobo: net_interest_payout,
        reference: detail.reference,
        batch_id: detail.batch_id,
        paid_at: detail.timestamp,
      },
      { onConflict: 'provider_payout_id', ignoreDuplicates: true }
    )
    .select('provider_payout_id');

  if (error) {
    throw new InterestLedgerError(
      'INTEREST_LEDGER_STORAGE_ERROR',
      'Interest payout record failed'
    );
  }
  return inserted !== null && inserted.length > 0 ? 'credited' : 'duplicate';
}

export async function sumPaidInterestKobo(
  supabase: SupabaseClient,
  walletId: string
): Promise<number> {
  const id = z.string().min(1).parse(walletId);
  const { data, error } = await supabase
    .from('piggyvest_interest_payouts')
    .select('net_kobo')
    .eq('wallet_id', id);
  if (error) {
    throw new InterestLedgerError(
      'INTEREST_LEDGER_STORAGE_ERROR',
      'Paid interest read failed'
    );
  }
  let total = 0;
  for (const row of data ?? []) {
    const parsed = netKoboRowSchema.safeParse(row);
    if (!parsed.success) {
      throw new InterestLedgerError(
        'INTEREST_LEDGER_STORAGE_ERROR',
        'Paid interest record is invalid'
      );
    }
    total += parsed.data.net_kobo;
  }
  return total;
}
