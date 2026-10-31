import 'server-only';

import { createHmac } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ImeiLookupRow } from '@/app/api/storefront/imei-check/route-helpers';
import type { PetrockProductSnapshot } from '@/lib/imei-providers/petrock/petrock-preflight';

const RPC_NAMES = new Set([
  'cancel_unsubmitted_petrock_imei_lookup',
  'redeem_imei_wallet_payment',
  'refund_imei_wallet_payment',
  'redeem_imei_wallet_and_begin_provider_submission',
  'record_petrock_imei_submission',
  'mark_petrock_imei_submission_unknown',
  'finalize_petrock_imei_lookup',
  'claim_petrock_imei_lookup_poll',
  'reschedule_petrock_imei_lookup_poll',
]);

export interface AccessResponse<T> {
  data: T | null;
  error: { code?: string; message: string } | null;
}

export interface ImeiRpcClient {
  rpc(
    name: string,
    args?: Record<string, unknown>
  ): PromiseLike<AccessResponse<unknown>>;
}

/** Construct only after session authentication and trusted storefront resolution.
 * Proofs authorize the exact serialized operation for two minutes; never return
 * this client, its transport arguments, or the signing secret to a browser.
 */
export function createImeiAccessClient({
  supabase,
  userId,
  merchantId,
  customerId,
}: {
  supabase: SupabaseClient;
  userId: string;
  merchantId: string;
  customerId: string;
}) {
  const secret = process.env.IMEI_ACCESS_SIGNING_SECRET;
  if (!secret || Buffer.byteLength(secret) < 32) {
    throw new Error('IMEI access signing configuration is unavailable');
  }
  async function call<T>(
    operation: string,
    args: Record<string, unknown>,
    rpcName: 'imei_lookup_access' | 'imei_claim_attempt' = 'imei_lookup_access'
  ) {
    const issuedAt = Math.floor(Date.now() / 1000);
    const payload = JSON.stringify({
      version: 1,
      actor: userId,
      customer: customerId,
      merchant: merchantId,
      operation,
      issuedAt,
      expiresAt: issuedAt + 120,
      args,
    });
    const signature = createHmac('sha256', secret as string)
      .update(`baci:imei-access:v1:${payload}`)
      .digest('hex');
    const result = await supabase.rpc(rpcName, {
      p_payload: payload,
      p_signature: signature,
    });
    return result as AccessResponse<T>;
  }
  return {
    // Intentionally rpc-only: no table client or privileged key is constructed.
    rpc: (name: string, args: Record<string, unknown> = {}) => {
      if (!RPC_NAMES.has(name)) throw new Error('Unsupported IMEI operation');
      return call(name, args);
    },
    claimAttempt: (args: {
      tier: string;
      imei_hash: string;
      idempotency_key: string;
      previous_lookup_id?: string;
    }) =>
      call<{ idempotency_key: string }>(
        'claim_attempt',
        args,
        'imei_claim_attempt'
      ),
    readReplay: (idempotencyKey: string) =>
      call<ImeiLookupRow>('read_replay', { idempotency_key: idempotencyKey }),
    readSnapshot: (productId: string) =>
      call<PetrockProductSnapshot>('read_snapshot', { product_id: productId }),
    readStatus: (lookupId: string) =>
      call<ImeiLookupRow>('read_status', { lookup_id: lookupId }),
    readPaymentState: (lookupId: string) =>
      call<{ debited: boolean; refunded: boolean }>('read_payment_state', {
        lookup_id: lookupId,
      }),
    insertPending: (row: Record<string, unknown>) =>
      call<{ id: string }>('insert_pending', row),
    cache: (lookupId: string, patch: Record<string, unknown>) =>
      call<{ id: string }>('cache', { lookup_id: lookupId, patch }),
    deletePending: (lookupId: string) =>
      call<{ id: string }>('delete_pending', { lookup_id: lookupId }),
  };
}

export type ImeiAccessClient = ReturnType<typeof createImeiAccessClient>;
