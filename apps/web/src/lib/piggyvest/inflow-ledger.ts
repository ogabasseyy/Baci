import 'server-only';
import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { BankTransferInflowSuccessEvent } from '@/schemas/piggyvest/events';
import { storedPvbCreditRowSchemas } from '@/schemas/piggyvest/stored-pvb-credit-rows';
import { alertCreditAuditDrift } from './credit-audit-drift';
import { resolvePlanWalletMapping } from './plan-wallet-mapping';
import { readStoredPvbCredit } from './stored-pvb-credit';

/**
 * Verified bank-transfer inflow ledger.
 *
 * Money-flow rules enforced here:
 * - One row per PVB credit (`pvb_reference`, the `PVB01…` credit id).
 *   PiggyVest confirmed on 2026-11-11 that pvb_reference is the credit's
 *   unique key and that `eventData.transaction_id` is internal-only.
 *   Redeliveries — even across distinct event_ids and with a different
 *   transaction_id — collapse on pvb_reference and never double-credit.
 *   transaction_id is kept as an audit column (still unique): a distinct
 *   pvb_reference reusing it cannot insert and is quarantined as a
 *   conflict. A redelivery whose financial fields differ from the stored
 *   row is a conflict: first writer wins and the processor quarantines
 *   the observation instead of acking it as a duplicate.
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
 *   `plan-transfer:{provider_transaction_id}` of the STORED row (the first
 *   writer's transaction id). The key deliberately did not move to
 *   pvb_reference: rows projected before the switch already hold the
 *   transaction-id key, and a new key would project them a second time.
 *   The RPC also rejects a reused key with a different transaction id, so
 *   a redelivery carrying a new transaction_id must reuse the stored one.
 *   The destination
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
        pvb_reference: event.pvb_reference,
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
      { onConflict: 'pvb_reference', ignoreDuplicates: true }
    )
    .select('pvb_reference');

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
  // id with different financials reaches this key: verify the stored row's
  // money and attribution fields before calling it a duplicate. First writer
  // wins; a mismatch is a provider conflict for quarantine, never a silent
  // ack.
  const stored = await readStoredPvbCredit(supabase, {
    table: 'piggyvest_inflow_credits',
    schema: storedPvbCreditRowSchemas.inflow,
    pvbReference: event.pvb_reference,
    legacyKeyColumn: 'provider_transaction_id',
    legacyKey: detail.transaction_id,
  }).catch(() => {
    throw new InflowLedgerError(
      'INFLOW_LEDGER_STORAGE_ERROR',
      'Inflow duplicate verify failed'
    );
  });
  if (!stored) {
    throw new InflowLedgerError(
      'INFLOW_LEDGER_STORAGE_ERROR',
      'Inflow duplicate receipt vanished before verify'
    );
  }
  const mismatchedFields: string[] = [];
  // A legacy row (NULL pvb_reference) is the same credit by its old key; a
  // different non-null pvb_reference means the internal transaction id was
  // reused by another credit. transaction_id itself is audit-only: the same
  // pvb_reference under a new transaction_id is a duplicate.
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
  if (stored.fee_kobo !== detail.fee) mismatchedFields.push('fee_kobo');
  // eventData.reference, session_id, id and timestamp are stored for audit
  // only. pvb_reference identifies the credit (PiggyVest, 2026-11-11) and
  // PiggyVest guarantees none of these internals stable across retries, so
  // a drift there is the same credit redelivered, not a conflict. With no
  // resend endpoint, a false conflict would strand the delivery.
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
          pvb_reference: event.pvb_reference,
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
  // Same credit: page (never conflict) if its audit-only internals drifted.
  alertCreditAuditDrift({
    eventType: 'bank-transfer.inflow.success',
    pvbReference: event.pvb_reference,
    driftedFields: [
      stored.provider_transaction_id !== detail.transaction_id &&
        'provider_transaction_id',
      stored.event_data_id !== detail.id && 'event_data_id',
      stored.reference !== detail.reference && 'reference',
      (stored.session_id ?? null) !== (detail.session_id ?? null) &&
        'session_id',
      new Date(stored.credited_at).getTime() !==
        new Date(detail.timestamp).getTime() && 'credited_at',
    ].filter((field): field is string => typeof field === 'string'),
  });
  // Redeliveries retry the projection: the first delivery may have
  // credited-then-thrown on ambiguity, and only a later delivery can
  // project once the goal set resolves to one candidate. Project under the
  // stored (first writer's) transaction id so the key matches any earlier
  // projection even when this delivery carries a different transaction_id.
  await projectPlanTransferOntoGoal(supabase, {
    customerId: mapping.customer_id,
    merchantId: mapping.merchant_id,
    amountKobo: detail.amount,
    providerTransactionId: stored.provider_transaction_id,
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
