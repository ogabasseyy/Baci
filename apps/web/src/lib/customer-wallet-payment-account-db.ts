import type { SupabaseClient } from '@supabase/supabase-js';
import { hasActivePaystackOrderDvaAlias } from '@/lib/payments/paystack-dva-order-alias';
import type { WalletDedicatedAccount } from '@/lib/paystack';
import {
  type CustomerWalletPaymentAccount,
  CustomerWalletPaymentAccountError,
  type CustomerWalletPaymentAccountRow,
  WALLET_PAYMENT_ACCOUNT_SELECT,
} from './customer-wallet-payment-account-types';

const POSTGRES_UNIQUE_VIOLATION = '23505';

export function normalizeWalletPaymentAccount(
  row: CustomerWalletPaymentAccountRow
): CustomerWalletPaymentAccount {
  if (row.provider !== 'paystack') {
    throw new CustomerWalletPaymentAccountError(
      'WALLET_DVA_STORAGE_ERROR',
      'Unsupported wallet payment account provider'
    );
  }

  if (!['active', 'disabled', 'pending_review'].includes(row.status)) {
    throw new CustomerWalletPaymentAccountError(
      'WALLET_DVA_STORAGE_ERROR',
      'Unsupported wallet payment account status'
    );
  }

  if (row.currency !== 'NGN') {
    throw new CustomerWalletPaymentAccountError(
      'WALLET_DVA_STORAGE_ERROR',
      'Unsupported wallet payment account currency'
    );
  }

  return {
    accountName: row.account_name,
    accountNumber: row.account_number,
    bankName: row.bank_name,
    bankSlug: row.bank_slug,
    consentedAt: row.consented_at,
    currency: 'NGN',
    customerId: row.customer_id,
    id: row.id,
    merchantId: row.merchant_id,
    metadata: row.metadata ?? {},
    provider: 'paystack',
    providerAccountId: row.provider_account_id,
    providerCustomerCode: row.provider_customer_code,
    providerSubaccountCode: row.provider_subaccount_code,
    status: row.status as CustomerWalletPaymentAccount['status'],
  };
}

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

/**
 * Status-agnostic lookup for the customer's own slot. The unique index covers
 * inactive rows too, so a retry after a disabled/pending_review row must find
 * it here — the active-only lookups above deliberately cannot.
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
  if (current) {
    return normalizeWalletPaymentAccount(current);
  }
  throw new CustomerWalletPaymentAccountError(
    'WALLET_DVA_STORAGE_ERROR',
    (error as { message?: string } | null)?.message ??
      'Failed to reactivate wallet payment account'
  );
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
    // disabled/pending_review row lands here. Self-heal by reactivating the
    // customer's own slot with the live provider account instead of
    // surfacing the raw constraint error.
    const stalledAccount = await findCustomerWalletPaymentAccountAnyStatus({
      customerId,
      merchantId,
      supabase,
    });
    if (stalledAccount) {
      if (
        stalledAccount.provider_subaccount_code !==
        account.providerSubaccountCode
      ) {
        throw new CustomerWalletPaymentAccountError(
          'WALLET_DVA_SUBACCOUNT_CONFLICT',
          'Existing wallet DVA belongs to a different Paystack subaccount'
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
  }

  if (error) {
    throw new CustomerWalletPaymentAccountError(
      'WALLET_DVA_STORAGE_ERROR',
      error.message
    );
  }

  return normalizeWalletPaymentAccount(data as CustomerWalletPaymentAccountRow);
}
