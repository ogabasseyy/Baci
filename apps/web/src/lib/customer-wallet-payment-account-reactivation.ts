import type { SupabaseClient } from '@supabase/supabase-js';
import type { WalletDedicatedAccount } from '@/lib/paystack';
import {
  type CustomerWalletPaymentAccount,
  CustomerWalletPaymentAccountError,
  type CustomerWalletPaymentAccountRow,
  normalizeWalletPaymentAccount,
  WALLET_PAYMENT_ACCOUNT_SELECT,
} from './customer-wallet-payment-account-types';

/**
 * Status-agnostic lookup for the customer's own slot. The unique index covers
 * inactive rows too, so a retry after a disabled/pending_review row must find
 * it here — the active-only lookups deliberately cannot.
 */
async function findCustomerWalletPaymentAccountAnyStatus({
  customerId,
  merchantId,
  supabase,
}: {
  customerId: string;
  merchantId: string;
  supabase: SupabaseClient;
}): Promise<CustomerWalletPaymentAccountRow | null> {
  const { data, error } = await supabase
    .from('customer_wallet_payment_accounts')
    .select(WALLET_PAYMENT_ACCOUNT_SELECT)
    .eq('merchant_id', merchantId)
    .eq('customer_id', customerId)
    .eq('provider', 'paystack')
    .maybeSingle();

  if (error) {
    throw new CustomerWalletPaymentAccountError(
      'WALLET_DVA_STORAGE_ERROR',
      error.message
    );
  }

  return (data as CustomerWalletPaymentAccountRow | null) ?? null;
}

async function reactivateWalletPaymentAccount({
  account,
  consentedAt,
  customerId,
  merchantId,
  rowId,
  supabase,
}: {
  account: WalletDedicatedAccount;
  consentedAt: Date;
  customerId: string;
  merchantId: string;
  rowId: string;
  supabase: SupabaseClient;
}): Promise<CustomerWalletPaymentAccount> {
  // The neq guard makes concurrent reactivations mutually exclusive: only
  // the first writer flips the inactive row. A loser converges on the
  // winner's active row instead of overwriting it with a different
  // provider account (which would split-brain the slot).
  const { data, error } = await supabase
    .from('customer_wallet_payment_accounts')
    .update({
      account_name: account.accountName,
      account_number: account.accountNumber,
      bank_name: account.bankName,
      bank_slug: account.bankSlug,
      consented_at: consentedAt.toISOString(),
      provider_account_id: account.providerAccountId,
      provider_customer_code: account.providerCustomerCode,
      provider_subaccount_code: account.providerSubaccountCode,
      status: 'active',
      updated_at: new Date().toISOString(),
    })
    .eq('id', rowId)
    .neq('status', 'active')
    .select(WALLET_PAYMENT_ACCOUNT_SELECT)
    .maybeSingle();

  if (!error && data) {
    return normalizeWalletPaymentAccount(
      data as CustomerWalletPaymentAccountRow
    );
  }

  const current = await findCustomerWalletPaymentAccountAnyStatus({
    customerId,
    merchantId,
    supabase,
  });
  // Converge only on a winner: when the guarded update failed with a real
  // storage error the row is still inactive, and returning it would let the
  // funding endpoint direct money at a DVA that was never reactivated.
  if (current && current.status === 'active') {
    return normalizeWalletPaymentAccount(current);
  }
  throw new CustomerWalletPaymentAccountError(
    'WALLET_DVA_STORAGE_ERROR',
    (error as { message?: string } | null)?.message ??
      'Failed to reactivate wallet payment account'
  );
}

/**
 * Resolves an insert conflict against a stalled (inactive) row in the
 * customer's own slot. Returns the reactivated account, or null when no
 * stalled row exists so the caller falls through to its default error path.
 *
 * Retained-DVA contract: a disabled row is never reactivated here —
 * re-enable requires a separately reviewed workflow that resolves the
 * original disable reason, and a new funding request is insufficient
 * authority. A pending_review row is repaired only when the immutable
 * provider identity matches; anything else stays conflict evidence for
 * review instead of being overwritten.
 */
export async function resolveStalledWalletPaymentAccount({
  account,
  consentedAt,
  customerId,
  merchantId,
  supabase,
}: {
  account: WalletDedicatedAccount;
  consentedAt: Date;
  customerId: string;
  merchantId: string;
  supabase: SupabaseClient;
}): Promise<CustomerWalletPaymentAccount | null> {
  const stalledAccount = await findCustomerWalletPaymentAccountAnyStatus({
    customerId,
    merchantId,
    supabase,
  });
  if (!stalledAccount) {
    return null;
  }
  if (stalledAccount.status === 'disabled') {
    throw new CustomerWalletPaymentAccountError(
      'WALLET_DVA_DISABLED_ACCOUNT',
      'This wallet transfer account was disabled after review. Contact support to re-enable it.'
    );
  }
  if (
    stalledAccount.provider_subaccount_code !== account.providerSubaccountCode
  ) {
    throw new CustomerWalletPaymentAccountError(
      'WALLET_DVA_SUBACCOUNT_CONFLICT',
      'Existing wallet DVA belongs to a different Paystack subaccount'
    );
  }
  if (
    stalledAccount.status === 'pending_review' &&
    (stalledAccount.provider_customer_code !== account.providerCustomerCode ||
      stalledAccount.account_number !== account.accountNumber ||
      (stalledAccount.provider_account_id ?? null) !==
        (account.providerAccountId ?? null))
  ) {
    throw new CustomerWalletPaymentAccountError(
      'WALLET_DVA_PENDING_REVIEW_CONFLICT',
      'Existing wallet DVA is under review for a different Paystack account'
    );
  }
  return reactivateWalletPaymentAccount({
    account,
    consentedAt,
    customerId,
    merchantId,
    rowId: stalledAccount.id,
    supabase,
  });
}
