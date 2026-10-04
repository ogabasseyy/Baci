import 'server-only';
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
 */

export type RecordInflowCreditOutcome = 'credited' | 'duplicate';

export class InflowLedgerError extends Error {
  readonly code:
    | 'INFLOW_LEDGER_INVALID'
    | 'INFLOW_LEDGER_UNMAPPED'
    | 'INFLOW_LEDGER_STORAGE_ERROR';

  constructor(code: InflowLedgerError['code'], message: string) {
    super(message);
    this.name = 'InflowLedgerError';
    this.code = code;
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
  return inserted !== null && inserted.length > 0 ? 'credited' : 'duplicate';
}
