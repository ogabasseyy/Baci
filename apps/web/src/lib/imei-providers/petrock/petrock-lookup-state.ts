import 'server-only';

import type { ImeiServiceTierKey } from '@baci/shared/imei';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ImeiRpcClient } from '@/lib/imei-access';
import type { ImeiLookupResponseBody } from '@/lib/imei-lookup-fulfillment';
import type { PetrockProductSnapshot } from './petrock-preflight';

type AdminClient = ImeiRpcClient;

export interface ClaimedPetrockLookup {
  amount_ngn: number | string;
  customer_id: string;
  id: string;
  identifier_ciphertext: string | null;
  lease_token: string;
  merchant_id: string;
  provider_attempt_started_at: string;
  provider_order_id: string | null;
  reconcile_attempts: number;
  status: 'pending_provider' | 'provider_submitting' | 'submission_unknown';
  tier: ImeiServiceTierKey;
}

export type ClaimedPetrockPoll = Pick<
  ClaimedPetrockLookup,
  'id' | 'identifier_ciphertext' | 'provider_order_id' | 'status' | 'tier'
> & { lease_token: string };

async function callBooleanRpc(
  supabaseAdmin: AdminClient,
  name: string,
  args: Record<string, unknown>
) {
  const { data, error } = await supabaseAdmin.rpc(name, args);
  if (error) throw error;
  return data === true;
}

export async function readPetrockProductSnapshot({
  productId,
  supabaseAdmin,
}: {
  productId: string;
  supabaseAdmin: SupabaseClient;
}): Promise<PetrockProductSnapshot | null> {
  const { data, error } = await supabaseAdmin
    .from('imei_provider_products')
    .select(
      'product_id, price_usd, currency, order_field_name, active, synced_at'
    )
    .eq('provider', 'petrock')
    .eq('product_id', productId)
    .maybeSingle();
  if (error) throw error;
  return data as PetrockProductSnapshot | null;
}

export function recordPetrockSubmission({
  leaseToken,
  lookupId,
  nextPollAt,
  orderId,
  providerStatus,
  supabaseAdmin,
}: {
  leaseToken?: string;
  lookupId: string;
  nextPollAt: string;
  orderId: string;
  providerStatus: string;
  supabaseAdmin: AdminClient;
}) {
  return callBooleanRpc(supabaseAdmin, 'record_petrock_imei_submission', {
    p_lease_token: leaseToken ?? null,
    p_lookup_id: lookupId,
    p_next_poll_at: nextPollAt,
    p_order_id: orderId,
    p_provider_status: providerStatus,
  });
}

export function markPetrockSubmissionUnknown({
  leaseToken,
  lookupId,
  providerOrderId,
  providerStatus,
  supabaseAdmin,
}: {
  leaseToken?: string;
  lookupId: string;
  providerOrderId?: string;
  providerStatus: string;
  supabaseAdmin: AdminClient;
}) {
  return callBooleanRpc(supabaseAdmin, 'mark_petrock_imei_submission_unknown', {
    p_lease_token: leaseToken ?? null,
    p_lookup_id: lookupId,
    p_order_id: providerOrderId ?? null,
    p_provider_status: providerStatus,
  });
}

export function finalizePetrockLookup({
  body,
  leaseToken,
  lookupId,
  providerStatus,
  responseHash,
  status,
  supabaseAdmin,
  terminalStatus,
}: {
  body: ImeiLookupResponseBody;
  leaseToken?: string;
  lookupId: string;
  providerStatus: string;
  responseHash?: string;
  status: number;
  supabaseAdmin: AdminClient;
  terminalStatus: 'completed' | 'refunded_error' | 'refunded_not_found';
}) {
  return callBooleanRpc(supabaseAdmin, 'finalize_petrock_imei_lookup', {
    p_cached_response: body,
    p_cached_status: status,
    p_lease_token: leaseToken ?? null,
    p_lookup_id: lookupId,
    p_provider_status: providerStatus,
    p_response_hash: responseHash ?? null,
    p_terminal_status: terminalStatus,
  });
}

export async function claimPetrockImeiLookups({
  leaseToken,
  limit = 25,
  supabaseAdmin,
}: {
  leaseToken: string;
  limit?: number;
  supabaseAdmin: AdminClient;
}): Promise<ClaimedPetrockLookup[]> {
  const { data, error } = await supabaseAdmin.rpc(
    'claim_petrock_imei_lookups',
    {
      p_lease_seconds: 90,
      p_lease_token: leaseToken,
      p_limit: limit,
    }
  );
  if (error) throw error;
  return (data ?? []) as ClaimedPetrockLookup[];
}

export async function claimPetrockLookupPoll({
  customerId,
  leaseToken,
  lookupId,
  merchantId,
  supabaseAdmin,
}: {
  customerId: string;
  leaseToken: string;
  lookupId: string;
  merchantId: string;
  supabaseAdmin: AdminClient;
}): Promise<ClaimedPetrockPoll | null> {
  const { data, error } = await supabaseAdmin.rpc(
    'claim_petrock_imei_lookup_poll',
    {
      p_customer_id: customerId,
      p_lease_seconds: 30,
      p_lease_token: leaseToken,
      p_lookup_id: lookupId,
      p_merchant_id: merchantId,
    }
  );
  if (error) throw error;
  return (
    (Array.isArray(data)
      ? (data[0] as ClaimedPetrockPoll | undefined)
      : undefined) ?? null
  );
}

export function reschedulePetrockLookupPoll({
  leaseToken,
  lookupId,
  nextPollAt,
  providerStatus,
  supabaseAdmin,
}: {
  leaseToken: string;
  lookupId: string;
  nextPollAt: string;
  providerStatus: string;
  supabaseAdmin: AdminClient;
}) {
  return callBooleanRpc(supabaseAdmin, 'reschedule_petrock_imei_lookup_poll', {
    p_lease_token: leaseToken,
    p_lookup_id: lookupId,
    p_next_poll_at: nextPollAt,
    p_provider_status: providerStatus,
  });
}
