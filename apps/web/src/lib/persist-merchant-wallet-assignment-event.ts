import type { SupabaseClient } from '@supabase/supabase-js';
import { persistVerifiedMerchantWalletAssignment } from './merchant-wallet-payment-accounts';

function isPaystackDvaAliasConflict(error: unknown): boolean {
  return (
    !!error &&
    typeof error === 'object' &&
    'message' in error &&
    String(error.message).includes('PAYSTACK_DVA_ALIAS_CONFLICT')
  );
}

export async function persistMerchantWalletAssignmentEvent(
  supabase: SupabaseClient,
  payload: Record<string, unknown>
) {
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
  const directSource =
    directMetadata && typeof directMetadata.source === 'string'
      ? directMetadata.source
      : null;
  // An explicit sibling-flow source on the assignment itself must win over
  // stale customer-level wallet funding metadata.
  if (directSource && directSource !== 'merchant_wallet_funding') {
    return { kind: 'ignored' as const };
  }
  const fundingMetadata =
    directSource === 'merchant_wallet_funding'
      ? directMetadata
      : customerMetadata?.source === 'merchant_wallet_funding'
        ? customerMetadata
        : null;
  const metadata = fundingMetadata ?? {};
  const requestId =
    typeof metadata.request_id === 'string' ? metadata.request_id : '';
  const merchantId =
    typeof metadata.merchant_id === 'string' ? metadata.merchant_id : '';
  if (metadata.source !== 'merchant_wallet_funding') {
    return { kind: 'ignored' as const };
  }
  if (!requestId || !merchantId) return { kind: 'review' as const };
  const account =
    data.dedicated_account && typeof data.dedicated_account === 'object'
      ? (data.dedicated_account as Record<string, unknown>)
      : data;
  const accountNumber =
    typeof account.account_number === 'string' ? account.account_number : '';
  const currency = typeof account.currency === 'string' ? account.currency : '';
  if (!/^\d{10,20}$/.test(accountNumber) || currency !== 'NGN')
    return { kind: 'review' as const };
  // Paystack's assignment payload may include these provider state flags.
  // When present, only an explicitly active and assigned account is trusted;
  // older payloads that omit either field remain supported.
  if (
    ('active' in account && account.active !== true) ||
    ('assigned' in account && account.assigned !== true)
  )
    return { kind: 'review' as const };
  const { data: requests, error: requestError } = await supabase
    .from('merchant_wallet_funding_account_requests')
    .select('id, status')
    .eq('id', requestId)
    .eq('merchant_id', merchantId)
    .in('status', ['pending', 'fulfilled']);
  if (requestError || !requests || requests.length !== 1)
    return { kind: 'review' as const };
  const bank =
    account.bank && typeof account.bank === 'object'
      ? (account.bank as Record<string, unknown>)
      : {};
  const accountCustomer =
    account.customer && typeof account.customer === 'object'
      ? (account.customer as Record<string, unknown>)
      : {};
  const providerCustomer =
    typeof accountCustomer.customer_code === 'string'
      ? accountCustomer
      : customer;
  const incoming = {
    accountNumber,
    accountName:
      typeof account.account_name === 'string' ? account.account_name : null,
    bankName: typeof bank.name === 'string' ? bank.name : null,
    currency,
    providerAccountId: account.id ? String(account.id) : null,
    providerCustomerCode: providerCustomer.customer_code
      ? String(providerCustomer.customer_code)
      : null,
  };
  if (requests[0].status === 'fulfilled') {
    const { data: existing, error: existingError } = await supabase
      .from('merchant_wallet_payment_accounts')
      .select(
        'account_number, account_name, bank_name, currency, provider_account_id, provider_customer_code'
      )
      .eq('request_id', requestId)
      .maybeSingle();
    if (existingError) return { kind: 'review' as const };
    return existing &&
      existing.account_number === incoming.accountNumber &&
      existing.account_name === incoming.accountName &&
      existing.bank_name === incoming.bankName &&
      existing.currency === incoming.currency &&
      existing.provider_account_id === incoming.providerAccountId &&
      existing.provider_customer_code === incoming.providerCustomerCode
      ? { kind: 'match' as const }
      : { kind: 'review' as const };
  }
  try {
    await persistVerifiedMerchantWalletAssignment(supabase, {
      requestId,
      merchantId,
      accountNumber,
      accountName: incoming.accountName,
      bankName: incoming.bankName,
      currency,
      providerAccountId: incoming.providerAccountId,
      providerCustomerCode: incoming.providerCustomerCode,
    });
    return { kind: 'match' as const };
  } catch (error: unknown) {
    if (!isPaystackDvaAliasConflict(error)) {
      return { kind: 'review' as const };
    }
    const { error: rejectError } = await supabase.rpc(
      'reject_merchant_wallet_funding_alias_conflict',
      {
        p_request_id: requestId,
        p_merchant_id: merchantId,
        p_account_number: accountNumber,
      }
    );
    if (rejectError) throw rejectError;
    return { kind: 'conflict' as const };
  }
}
