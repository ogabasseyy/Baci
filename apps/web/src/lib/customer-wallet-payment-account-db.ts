import type { SupabaseClient } from '@supabase/supabase-js';
import { hasActivePaystackOrderDvaAlias } from '@/lib/payments/paystack-dva-order-alias';
import type { WalletDedicatedAccount } from '@/lib/paystack';
import { resolveStalledWalletPaymentAccount } from './customer-wallet-payment-account-reactivation';
import {
  type CustomerWalletPaymentAccount,
  CustomerWalletPaymentAccountError,
  type CustomerWalletPaymentAccountRow,
  normalizeWalletPaymentAccount,
  WALLET_PAYMENT_ACCOUNT_SELECT,
} from './customer-wallet-payment-account-types';

// Re-exported so existing importers are unaffected by the split.
export { normalizeWalletPaymentAccount };

const POSTGRES_UNIQUE_VIOLATION = '23505';

async function assertNoActiveOrderPaymentAccountAlias({
  accountNumber,
  asOf,
  supabase,
}: {
  accountNumber: string;
  asOf: Date;
  supabase: SupabaseClient;
}) {
  let aliasesActiveOrder = false;
  try {
    aliasesActiveOrder = await hasActivePaystackOrderDvaAlias({
      accountNumber,
      asOf,
      supabase,
    });
  } catch (error) {
    throw new CustomerWalletPaymentAccountError(
      'WALLET_DVA_STORAGE_ERROR',
      error instanceof Error ? error.message : 'Failed to check order DVA alias'
    );
  }

  if (aliasesActiveOrder) {
    throw new CustomerWalletPaymentAccountError(
      'WALLET_DVA_ORDER_ALIAS_CONFLICT',
      'This Paystack account is still reserved for an active order payment'
    );
  }
}

export async function resolveCustomerWalletPaymentAccount({
  customerId,
  merchantId,
  supabase,
}: {
  customerId: string;
  merchantId: string;
  supabase: SupabaseClient;
}): Promise<CustomerWalletPaymentAccount | null> {
  const { data, error } = await supabase
    .from('customer_wallet_payment_accounts')
    .select(WALLET_PAYMENT_ACCOUNT_SELECT)
    .eq('merchant_id', merchantId)
    .eq('customer_id', customerId)
    .eq('provider', 'paystack')
    .eq('status', 'active')
    .maybeSingle();

  if (error) {
    throw new CustomerWalletPaymentAccountError(
      'WALLET_DVA_STORAGE_ERROR',
      error.message
    );
  }

  return data
    ? normalizeWalletPaymentAccount(data as CustomerWalletPaymentAccountRow)
    : null;
}

export async function findCustomerWalletPaymentAccountByReceiver({
  receiverAccountNumber,
  supabase,
}: {
  receiverAccountNumber: string;
  supabase: SupabaseClient;
}): Promise<CustomerWalletPaymentAccount | null> {
  const { data, error } = await supabase
    .from('customer_wallet_payment_accounts')
    .select(WALLET_PAYMENT_ACCOUNT_SELECT)
    .eq('provider', 'paystack')
    .eq('account_number', receiverAccountNumber)
    .eq('status', 'active')
    .maybeSingle();

  if (error) {
    throw new CustomerWalletPaymentAccountError(
      'WALLET_DVA_STORAGE_ERROR',
      error.message
    );
  }

  return data
    ? normalizeWalletPaymentAccount(data as CustomerWalletPaymentAccountRow)
    : null;
}

export async function persistWalletPaymentAccount({
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
}) {
  await assertNoActiveOrderPaymentAccountAlias({
    accountNumber: account.accountNumber,
    asOf: new Date(),
    supabase,
  });

  const payload = {
    account_name: account.accountName,
    account_number: account.accountNumber,
    bank_name: account.bankName,
    bank_slug: account.bankSlug,
    consented_at: consentedAt.toISOString(),
    currency: account.currency,
    customer_id: customerId,
    merchant_id: merchantId,
    metadata: {
      source: 'wallet_dva',
    },
    provider: 'paystack' as const,
    provider_account_id: account.providerAccountId,
    provider_customer_code: account.providerCustomerCode,
    provider_subaccount_code: account.providerSubaccountCode,
    status: 'active' as const,
  };

  const { data, error } = await supabase
    .from('customer_wallet_payment_accounts')
    .insert(payload)
    .select(WALLET_PAYMENT_ACCOUNT_SELECT)
    .single();

  if (
    error &&
    (error as { code?: string }).code === POSTGRES_UNIQUE_VIOLATION
  ) {
    const existingAccount = await resolveCustomerWalletPaymentAccount({
      customerId,
      merchantId,
      supabase,
    });
    if (existingAccount) {
      return existingAccount;
    }

    const receiverAccount = await findCustomerWalletPaymentAccountByReceiver({
      receiverAccountNumber: account.accountNumber,
      supabase,
    });
    if (
      receiverAccount?.customerId === customerId &&
      receiverAccount.merchantId === merchantId
    ) {
      return receiverAccount;
    }

    if (receiverAccount) {
      throw new CustomerWalletPaymentAccountError(
        'WALLET_DVA_RECEIVER_CONFLICT',
        'This Paystack wallet DVA is already assigned to another customer'
      );
    }

    // The unique slot covers inactive rows: a retry after a
    // disabled/pending_review row lands here. Null means no stalled row —
    // fall through to the default unique-violation error below.
    const reactivatedAccount = await resolveStalledWalletPaymentAccount({
      account,
      consentedAt,
      customerId,
      merchantId,
      supabase,
    });
    if (reactivatedAccount) {
      return reactivatedAccount;
    }
  }

  if (error) {
    throw new CustomerWalletPaymentAccountError(
      'WALLET_DVA_STORAGE_ERROR',
      error.message
    );
  }

  return normalizeWalletPaymentAccount(data as CustomerWalletPaymentAccountRow);
}
