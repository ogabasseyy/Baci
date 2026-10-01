import type { SupabaseClient } from '@supabase/supabase-js';

function payloadData(payload: Record<string, unknown>) {
  return payload.data && typeof payload.data === 'object'
    ? (payload.data as Record<string, unknown>)
    : {};
}

function payloadMetadata(data: Record<string, unknown>) {
  const directMetadata =
    data.metadata && typeof data.metadata === 'object'
      ? (data.metadata as Record<string, unknown>)
      : null;
  const customer =
    data.customer && typeof data.customer === 'object'
      ? (data.customer as Record<string, unknown>)
      : {};
  const customerMetadata =
    customer.metadata && typeof customer.metadata === 'object'
      ? (customer.metadata as Record<string, unknown>)
      : null;
  return directMetadata && 'source' in directMetadata
    ? directMetadata
    : (customerMetadata ?? directMetadata ?? {});
}

export async function failMerchantWalletAssignmentEvent(
  supabase: SupabaseClient,
  payload: Record<string, unknown>
) {
  const metadata = payloadMetadata(payloadData(payload));
  if (metadata.source !== 'merchant_wallet_funding') {
    return 'source' in metadata
      ? { kind: 'ignored' as const }
      : { kind: 'review' as const };
  }
  const requestId =
    typeof metadata.request_id === 'string' ? metadata.request_id : '';
  const merchantId =
    typeof metadata.merchant_id === 'string' ? metadata.merchant_id : '';
  if (!requestId || !merchantId) return { kind: 'review' as const };

  const { data: request, error: requestError } = await supabase
    .from('merchant_wallet_funding_account_requests')
    .select('id, status')
    .eq('id', requestId)
    .eq('merchant_id', merchantId)
    .maybeSingle();
  if (requestError || !request) return { kind: 'review' as const };
  if (request.status !== 'pending') return { kind: 'match' as const };

  const { data: failed, error: failureError } = await supabase
    .from('merchant_wallet_funding_account_requests')
    .update({ status: 'failed' })
    .eq('id', requestId)
    .eq('merchant_id', merchantId)
    .eq('status', 'pending')
    .select('id, status')
    .maybeSingle();
  if (failureError || !failed || failed.status !== 'failed')
    return { kind: 'review' as const };
  return { kind: 'match' as const };
}
