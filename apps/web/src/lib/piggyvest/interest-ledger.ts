import 'server-only';
import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import z from 'zod';
import type { InterestPayoutSuccessEvent } from '@/schemas/piggyvest/events';
import { storedPvbCreditRowSchemas } from '@/schemas/piggyvest/stored-pvb-credit-rows';
import { alertCreditAuditDrift } from './credit-audit-drift';
import { resolvePlanWalletMapping } from './plan-wallet-mapping';
import {
  creditWriteFailureMessage,
  readStoredPvbCredit,
} from './stored-pvb-credit';

/**
 * Verified interest-payout ledger.
 *
 * Money-flow rules enforced here:
 * - One row per PVB credit (`pvb_reference`). PiggyVest confirmed on
 *   2026-11-11 that pvb_reference is a credit's unique key; `eventData.id`
 *   sits beside the internal ids PiggyVest said not to key on and was only
 *   ever seen in a sample, so it is kept as a (still unique) audit column.
 *   Redeliveries — even across distinct event_ids — collapse on
 *   pvb_reference and can never double-credit. A redelivery whose
 *   financial fields differ from the stored row is a conflict: first
 *   writer wins and the processor quarantines the observation instead of
 *   acking it as a duplicate.
 * - Arithmetic is verified before credit: gross − tax must equal net, and
 *   the envelope amount must equal net. A violation fails closed as
 *   poison (ack-without-credit), never as a partial or adjusted credit.
 *   The table's CHECK constraints backstop the app check.
 * - No credit is written unless the event's provider (customer,
 *   pvb_wallet) pair resolves to a known plan-wallet mapping. Unmapped
 *   payouts fail retryable (INTEREST_LEDGER_UNMAPPED): attribution, not
 *   arithmetic, is what is missing, and a later mapping must still be
 *   able to credit.
 * - Only reconciled net payouts are credited. Pending accrual is never
 *   spendable and is never written here.
 */

export type RecordInterestPayoutOutcome = 'credited' | 'duplicate';

export type InterestLedgerConflict = {
  providerPayoutId: string;
  mismatchedFields: string[];
  bodyDigest: string;
};

export class InterestLedgerError extends Error {
  readonly code:
    | 'INTEREST_LEDGER_INCONSISTENT'
    | 'INTEREST_LEDGER_UNMAPPED'
    | 'INTEREST_LEDGER_CONFLICT'
    | 'INTEREST_LEDGER_STORAGE_ERROR';
  readonly conflict?: InterestLedgerConflict;

  constructor(
    code: InterestLedgerError['code'],
    message: string,
    conflict?: InterestLedgerConflict
  ) {
    super(message);
    this.name = 'InterestLedgerError';
    this.code = code;
    this.conflict = conflict;
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

  // Exact attribution only: the credited plan wallet is the envelope
  // pvb_wallet. PiggyVest confirmed on 2026-11-11 that
  // eventData.destination_wallet is PVB's internal wallet id (it never
  // matches a plan-wallet mapping, and live inflow probes showed the nested
  // internal id 404s on the wallet API), while pvb_wallet is the PVB wallet
  // the payout credited. Ambiguous attribution fails retryable without
  // credit.
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
        pvb_reference: event.pvb_reference,
        provider_payout_id: detail.id,
        event_id: event.eventId,
        customer_id: event.customer_id,
        wallet_id: mapping.wallet_id,
        amount_kobo: detail.amount,
        gross_kobo: gross_interest_payout,
        withholding_tax_kobo: withholding_tax,
        net_kobo: net_interest_payout,
        reference: detail.reference,
        batch_id: detail.batch_id,
        paid_at: detail.timestamp,
      },
      { onConflict: 'pvb_reference', ignoreDuplicates: true }
    )
    .select('pvb_reference');

  if (error) {
    throw new InterestLedgerError(
      'INTEREST_LEDGER_STORAGE_ERROR',
      creditWriteFailureMessage(error, 'Interest payout record failed')
    );
  }
  if (inserted !== null && inserted.length > 0) return 'credited';

  // The inbox dedupes by event_id, so a signed redelivery under a new event
  // id with different financials reaches this key: verify the stored row
  // before calling it a duplicate. First writer wins; a mismatch is a
  // provider conflict for quarantine, never a silent ack.
  const found = await readStoredPvbCredit(supabase, {
    table: 'piggyvest_interest_payouts',
    schema: storedPvbCreditRowSchemas.interest,
    pvbReference: event.pvb_reference,
    legacyKeyColumn: 'provider_payout_id',
    legacyKey: detail.id,
  }).catch(() => {
    throw new InterestLedgerError(
      'INTEREST_LEDGER_STORAGE_ERROR',
      'Interest duplicate verify failed'
    );
  });
  if (!found) {
    throw new InterestLedgerError(
      'INTEREST_LEDGER_STORAGE_ERROR',
      'Interest duplicate receipt vanished before verify'
    );
  }
  const stored = found.row;
  const mismatchedFields: string[] = [];
  // The incoming internal id belongs to a different stored credit: a reuse
  // the pvb_reference match alone would miss.
  if (found.legacyKeyOwnedByOther) mismatchedFields.push('provider_payout_id');
  // A legacy row (NULL pvb_reference) is the same payout by its old key; a
  // different non-null pvb_reference means another credit reused the id.
  // provider_payout_id itself is audit-only, like the inflow transaction id.
  if (
    (stored.pvb_reference ?? null) !== null &&
    stored.pvb_reference !== event.pvb_reference
  )
    mismatchedFields.push('pvb_reference');
  if (stored.customer_id !== event.customer_id)
    mismatchedFields.push('customer_id');
  if (stored.wallet_id !== mapping.wallet_id)
    mismatchedFields.push('wallet_id');
  if (stored.amount_kobo !== detail.amount)
    mismatchedFields.push('amount_kobo');
  if (stored.gross_kobo !== gross_interest_payout)
    mismatchedFields.push('gross_kobo');
  if (stored.withholding_tax_kobo !== withholding_tax)
    mismatchedFields.push('withholding_tax_kobo');
  if (stored.net_kobo !== net_interest_payout)
    mismatchedFields.push('net_kobo');
  // eventData internals are audit-only, like the inflow ones: drift is the
  // same payout redelivered (paged below). A legacy row (NULL
  // pvb_reference) was matched by its internal id alone, so it keeps the
  // strict pre-change comparison.
  const driftedFields = [
    stored.provider_payout_id !== detail.id && 'provider_payout_id',
    stored.reference !== detail.reference && 'reference',
    stored.batch_id !== detail.batch_id && 'batch_id',
    new Date(stored.paid_at).getTime() !==
      new Date(detail.timestamp).getTime() && 'paid_at',
  ].filter((field): field is string => typeof field === 'string');
  if ((stored.pvb_reference ?? null) === null)
    mismatchedFields.push(...driftedFields);
  if (mismatchedFields.length > 0) {
    const bodyDigest = createHash('sha256')
      .update(
        JSON.stringify({
          customer_id: event.customer_id,
          wallet_id: mapping.wallet_id,
          amount_kobo: detail.amount,
          gross_kobo: gross_interest_payout,
          withholding_tax_kobo: withholding_tax,
          net_kobo: net_interest_payout,
          reference: detail.reference,
          batch_id: detail.batch_id,
          paid_at: detail.timestamp,
          pvb_reference: event.pvb_reference,
          provider_payout_id: detail.id,
        })
      )
      .digest('hex');
    throw new InterestLedgerError(
      'INTEREST_LEDGER_CONFLICT',
      'Interest redelivery conflicts with the credited row',
      {
        providerPayoutId: detail.id,
        mismatchedFields,
        bodyDigest,
      }
    );
  }
  alertCreditAuditDrift({
    eventType: 'interest-payout.success',
    pvbReference: event.pvb_reference,
    driftedFields,
  });
  return 'duplicate';
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
