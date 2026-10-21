import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';

/**
 * Prepare-INSERT executors for VTU checkout (extracted from
 * vtu-pending-transaction.ts per the Boy Scout Rule).
 *
 * Two paths, one payload: privileged callers (`/api/vtu/purchase`)
 * keep the direct insert; the wallet-only checkout (Phase 2, epic
 * #3694) inserts through the service-role-only
 * `insert_prepared_vtu_transaction` RPC — there is deliberately no
 * buyer INSERT policy (direct writes would be a mint primitive),
 * and the RPC takes no authenticated EXECUTE either: its
 * settlement fields are server-computed money that must never be
 * caller-supplied (Codex P1, PR #3741). Both return the same
 * prepared shape and throw the same whitelisted error on failure.
 */

export type VtuTransactionInsertPayload =
  Database['public']['Tables']['vtu_transactions']['Insert'];

export interface InsertedPreparedVtuTransaction {
  id: string;
  amount: number;
  customer_identifier: string | null;
  metadata: Record<string, unknown> | null;
  request_reference: string;
  status: string;
  type: string;
}

/** Direct insert for privileged (service-role) callers. */
export async function insertPreparedVtuTransactionDirect(
  supabase: SupabaseClient,
  payload: VtuTransactionInsertPayload
): Promise<InsertedPreparedVtuTransaction> {
  const { data: transaction, error: transactionError } = await supabase
    .from('vtu_transactions')
    .insert(payload)
    .select(
      'id, amount, customer_identifier, metadata, request_reference, status, type'
    )
    .single();

  if (transactionError || !transaction) {
    throw new Error('Failed to initiate purchase');
  }
  return transaction as InsertedPreparedVtuTransaction;
}

/** Ownership-verified RPC insert for the RLS-bound checkout. */
export async function insertPreparedVtuTransactionViaRpc(
  supabase: SupabaseClient,
  payload: VtuTransactionInsertPayload & { customer_id: string },
  userId: string
): Promise<InsertedPreparedVtuTransaction> {
  const { data, error } = await supabase.rpc(
    'insert_prepared_vtu_transaction',
    {
      p_merchant_id: payload.merchant_id,
      p_customer_id: payload.customer_id,
      p_user_id: userId,
      p_order_id: payload.order_id ?? null,
      p_type: payload.type,
      p_network_provider: payload.network_provider,
      p_phone_number: payload.phone_number,
      p_amount: payload.amount,
      p_request_reference: payload.request_reference,
      p_source: payload.source ?? 'checkout',
      p_platform_commission: payload.platform_commission ?? null,
      p_merchant_commission: payload.merchant_commission ?? null,
      p_customer_cashback: payload.customer_cashback ?? null,
      p_biller_name: payload.biller_name ?? null,
      p_biller_item_code: payload.biller_item_code ?? null,
      p_customer_identifier: payload.customer_identifier ?? null,
      p_customer_name: payload.customer_name ?? null,
      p_metadata: payload.metadata ?? {},
    }
  );
  const inserted = data?.[0];
  if (error || !inserted) {
    throw new Error('Failed to initiate purchase');
  }
  return {
    id: inserted.id,
    amount: inserted.amount,
    customer_identifier: inserted.customer_identifier,
    metadata: inserted.metadata as Record<string, unknown> | null,
    request_reference: inserted.request_reference,
    status: inserted.status,
    type: inserted.type,
  };
}
