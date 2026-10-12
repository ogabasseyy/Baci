import 'server-only';
import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { BankTransferInflowSuccessEvent } from '@/schemas/piggyvest/events';
import { resolvePlanWalletMapping } from './plan-wallet-mapping';

/**
 * Verified bank-transfer inflow ledger.
 *
 * Money-flow rules enforced here:
 * - One row per provider transaction identity
 *   (`eventData.transaction_id`). Redeliveries — even across distinct
 *   event_ids — collapse on that key and can never double-credit.
 *   A redelivery whose financial fields differ from the stored row is a
 *   conflict: first writer wins and the processor quarantines the
 *   observation instead of acking it as a duplicate.
 * - Amount must be positive. A zero-amount inflow is poison: acked as
 *   failed without credit, never retried into existence.
 * - No credit is written unless the event's provider (customer, wallet)
 *   pair resolves to a known plan-wallet mapping. Unmapped events fail
 *   retryable (INFLOW_LEDGER_UNMAPPED) so the provider redelivers: the
 *   creation webhook may arrive before the mapping write, and crediting
 *   an unattributed wallet would mint tenant-less money.
 * - No sender identity is stored. Bank account numbers and names appear in
 *   inflow payloads; persisting them would defeat the inbox's no-raw-
 *   payload rule, so this table carries references and amounts only.
 * - A credited inflow records provider confirmation, not a balance
 *   movement: wallet balances remain live provider reads.
 * - Every credit-or-verified-duplicate then projects onto a savings goal
 *   via `allocate_plan_transfer_contribution`, keyed by
 *   `plan-transfer:{provider_transaction_id}`. The destination
 *   (provider wallet, customer) pair is passed so the RPC binds to the
 *   funding flow's mapped goal instead of inferring from the goal count;
 *   unmapped wallets fall back to the single-candidate census. Zero
 *   candidates is a definitive skip (the audit row carries the funds
 *   record), while ambiguity throws INFLOW_LEDGER_UNRESOLVED so the
 *   provider redelivers and a later delivery can project. Projection runs
 *   on the duplicate path too, because the credit insert and the
 *   projection are separate statements: a first delivery may
 *   credit-then-throw on ambiguity, and redeliveries must retry the
 *   projection, not skip it.
 */

export type RecordInflowCreditOutcome = 'credited' | 'duplicate';

export type InflowLedgerConflict = {
  providerTransactionId: string;
  mismatchedFields: string[];
  bodyDigest: string;
};

export class InflowLedgerError extends Error {
  readonly code:
    | 'INFLOW_LEDGER_INVALID'
    | 'INFLOW_LEDGER_UNMAPPED'
    | 'INFLOW_LEDGER_CONFLICT'
    | 'INFLOW_LEDGER_UNRESOLVED'
    | 'INFLOW_LEDGER_STORAGE_ERROR';
  readonly conflict?: InflowLedgerConflict;

  constructor(
    code: InflowLedgerError['code'],
    message: string,
    conflict?: InflowLedgerConflict
  ) {
    super(message);
    this.name = 'InflowLedgerError';
    this.code = code;
    this.conflict = conflict;
  }
}

export async function recordInflowCredit(
  supabase: SupabaseClient,
  event: BankTransferInflowSuccessEvent
): Promise<RecordInflowCreditOutcome> {
  const detail = event.eventData;
  if (detail.amount <= 0) {
    throw new InflowLedgerError(
      'INFLOW_LEDGER_INVALID',
      'Inflow amount is not positive'
    );
  }

  // Exact attribution only: the credited plan wallet in pvb_wallet must
  // match a mapping row with the event's provider customer. The nested
  // destination_wallet_id is a provider-side conduit id that may differ
  // legitimately; it is never an attribution substitute. Ambiguous or
  // conduit-only attribution fails retryable without credit.
  const mapping = await resolvePlanWalletMapping(supabase, {
    piggyvestCustomerId: event.customer_id,
    walletId: event.pvb_wallet,
  }).catch((error: unknown) => {
    throw new InflowLedgerError(
      'INFLOW_LEDGER_STORAGE_ERROR',
      error instanceof Error ? error.message : 'Mapping lookup failed'
    );
  });
  if (!mapping) {
    throw new InflowLedgerError(
      'INFLOW_LEDGER_UNMAPPED',
      'Inflow wallet has no verified plan-wallet mapping'
    );
  }

  const { data: inserted, error } = await supabase
    .from('piggyvest_inflow_credits')
    .upsert(
      {
        provider_transaction_id: detail.transaction_id,
        event_data_id: detail.id,
        event_id: event.eventId,
        customer_id: event.customer_id,
        wallet_id: mapping.wallet_id,
        amount_kobo: detail.amount,
        fee_kobo: detail.fee,
        reference: detail.reference,
        session_id: detail.session_id ?? null,
        credited_at: detail.timestamp,
      },
      { onConflict: 'provider_transaction_id', ignoreDuplicates: true }
    )
    .select('provider_transaction_id');

  if (error) {
    throw new InflowLedgerError(
      'INFLOW_LEDGER_STORAGE_ERROR',
      'Inflow credit record failed'
    );
  }
  if (inserted !== null && inserted.length > 0) {
    await projectPlanTransferOntoGoal(supabase, {
      customerId: mapping.customer_id,
      merchantId: mapping.merchant_id,
      amountKobo: detail.amount,
      providerTransactionId: detail.transaction_id,
      providerWalletId: event.pvb_wallet,
      providerCustomerId: event.customer_id,
    });
    return 'credited';
  }

  // The inbox dedupes by event_id, so a signed redelivery under a new event
  // id with different financials reaches this key: verify the stored row
  // before calling it a duplicate. First writer wins; a mismatch is a
  // provider conflict for quarantine, never a silent ack.
  const existing = await supabase
    .from('piggyvest_inflow_credits')
    .select(
      'customer_id, wallet_id, amount_kobo, fee_kobo, reference, session_id, event_data_id, credited_at'
    )
    .eq('provider_transaction_id', detail.transaction_id)
    .maybeSingle();
  if (existing.error) {
    throw new InflowLedgerError(
      'INFLOW_LEDGER_STORAGE_ERROR',
      'Inflow duplicate verify failed'
    );
  }
  if (!existing.data) {
    throw new InflowLedgerError(
      'INFLOW_LEDGER_STORAGE_ERROR',
      'Inflow duplicate receipt vanished before verify'
    );
  }
  const stored = existing.data;
  const mismatchedFields: string[] = [];
  if (stored.customer_id !== event.customer_id)
    mismatchedFields.push('customer_id');
  if (stored.wallet_id !== mapping.wallet_id)
    mismatchedFields.push('wallet_id');
  if (stored.amount_kobo !== detail.amount)
    mismatchedFields.push('amount_kobo');
  if (stored.fee_kobo !== detail.fee) mismatchedFields.push('fee_kobo');
  if (stored.reference !== detail.reference) mismatchedFields.push('reference');
  if ((stored.session_id ?? null) !== (detail.session_id ?? null))
    mismatchedFields.push('session_id');
  if (stored.event_data_id !== detail.id)
    mismatchedFields.push('event_data_id');
  // Epoch compare: the stored timestamptz round-trips in a normalized
  // format that never string-equals the payload's ISO instant.
  if (
    new Date(stored.credited_at).getTime() !==
    new Date(detail.timestamp).getTime()
  )
    mismatchedFields.push('credited_at');
  if (mismatchedFields.length > 0) {
    const bodyDigest = createHash('sha256')
      .update(
        JSON.stringify({
          customer_id: event.customer_id,
          wallet_id: mapping.wallet_id,
          amount_kobo: detail.amount,
          fee_kobo: detail.fee,
          reference: detail.reference,
          session_id: detail.session_id ?? null,
          event_data_id: detail.id,
          credited_at: detail.timestamp,
          provider_transaction_id: detail.transaction_id,
        })
      )
      .digest('hex');
    throw new InflowLedgerError(
      'INFLOW_LEDGER_CONFLICT',
      'Inflow redelivery conflicts with the credited row',
      {
        providerTransactionId: detail.transaction_id,
        mismatchedFields,
        bodyDigest,
      }
    );
  }
  // Redeliveries retry the projection: the first delivery may have
  // credited-then-thrown on ambiguity, and only a later delivery can
  // project once the goal set resolves to one candidate.
  await projectPlanTransferOntoGoal(supabase, {
    customerId: mapping.customer_id,
    merchantId: mapping.merchant_id,
    amountKobo: detail.amount,
    providerTransactionId: detail.transaction_id,
    providerWalletId: event.pvb_wallet,
    providerCustomerId: event.customer_id,
  });
  return 'duplicate';
}

async function projectPlanTransferOntoGoal(
  supabase: SupabaseClient,
  input: {
    customerId: string;
    merchantId: string;
    amountKobo: number;
    providerTransactionId: string;
    providerWalletId: string;
    providerCustomerId: string;
  }
): Promise<void> {
  const { error } = await supabase.rpc('allocate_plan_transfer_contribution', {
    p_customer_id: input.customerId,
    p_merchant_id: input.merchantId,
    p_amount_kobo: input.amountKobo,
    p_provider_transaction_id: input.providerTransactionId,
    p_idempotency_key: `plan-transfer:${input.providerTransactionId}`,
    // Bind the projection to the destination account's mapped goal: the
    // funding flow provisions one wallet per goal, so a customer with two
    // allocatable goals still attributes exactly. Unmapped wallets fall
    // back to the single-candidate census inside the RPC.
    p_provider_wallet_id: input.providerWalletId,
    p_provider_customer_id: input.providerCustomerId,
  });
  if (!error) return;
  if (error.code === 'P0001') {
    throw new InflowLedgerError(
      'INFLOW_LEDGER_UNRESOLVED',
      'Plan transfer requires reconciliation before goal projection'
    );
  }
  throw new InflowLedgerError(
    'INFLOW_LEDGER_STORAGE_ERROR',
    'Plan transfer goal projection failed'
  );
}
