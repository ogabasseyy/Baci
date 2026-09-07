import type { SupabaseClient } from '@supabase/supabase-js';

const POSTGRES_UNIQUE_VIOLATION = '23505';

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export async function persistMerchantWalletAssignmentReview(
  supabase: SupabaseClient,
  payload: Record<string, unknown>
): Promise<void> {
  const data =
    payload.data && typeof payload.data === 'object'
      ? (payload.data as Record<string, unknown>)
      : {};
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
  const metadata =
    directMetadata?.source === 'merchant_wallet_funding'
      ? directMetadata
      : customerMetadata?.source === 'merchant_wallet_funding'
        ? customerMetadata
        : (directMetadata ?? customerMetadata ?? {});
  const merchantIdRaw = readString(metadata.merchant_id);
  const merchantId =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      merchantIdRaw
    )
      ? merchantIdRaw
      : '';
  const requestId = readString(metadata.request_id);
  const account =
    data.dedicated_account && typeof data.dedicated_account === 'object'
      ? (data.dedicated_account as Record<string, unknown>)
      : data;
  const accountNumber = readString(account.account_number);
  const paystackRef =
    readString(payload.id) ||
    readString(data.assignment_id) ||
    readString(account.id) ||
    requestId ||
    accountNumber;

  const { error } = await supabase.from('reconciliation_review').insert({
    candidates: [],
    issue_type: 'merchant_wallet_assignment_review',
    merchant_id: merchantId || null,
    metadata: {
      account_number: accountNumber || null,
      currency: readString(account.currency) || null,
      event: readString(payload.event) || null,
      merchant_id_raw: merchantIdRaw || null,
      request_id: requestId || null,
      source: readString(metadata.source) || null,
    },
    paystack_ref: paystackRef || null,
    reason:
      'Paystack merchant wallet dedicated-account assignment requires manual review.',
  });

  if (
    error &&
    (error as { code?: string }).code !== POSTGRES_UNIQUE_VIOLATION
  ) {
    throw error;
  }
}
