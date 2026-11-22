import type { SupabaseClient } from '@supabase/supabase-js';
import type { WalletDedicatedAccount } from '@/lib/paystack';
import {
  type CustomerWalletPaymentAccount,
  CustomerWalletPaymentAccountError,
  type CustomerWalletPaymentAccountRow,
  normalizeWalletPaymentAccount,
  WALLET_PAYMENT_ACCOUNT_SELECT,
} from './customer-wallet-payment-account-types';
import type { WalletDvaProvisionerInput } from './wallet-dva-provisioner-executor';

// Re-exported so existing importers are unaffected by the split.
export { normalizeWalletPaymentAccount };

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
  userId,
  writeVerifiedAccount,
}: {
  account: WalletDedicatedAccount;
  consentedAt: Date;
  customerId: string;
  merchantId: string;
  userId: string;
  writeVerifiedAccount: (
    input: WalletDvaProvisionerInput
  ) => Promise<CustomerWalletPaymentAccount>;
}) {
  if (
    userId == null ||
    userId.trim().length === 0 ||
    writeVerifiedAccount == null
  ) {
    throw new CustomerWalletPaymentAccountError(
      'WALLET_DVA_WRITER_UNAVAILABLE',
      'Wallet funding account storage is unavailable'
    );
  }
  const written = await writeVerifiedAccount({
    accountName: account.accountName,
    accountNumber: account.accountNumber,
    bankName: account.bankName,
    bankSlug: account.bankSlug,
    consentedAt: consentedAt.toISOString(),
    currency: account.currency,
    customerId,
    merchantId,
    providerAccountId: account.providerAccountId,
    providerCustomerCode: account.providerCustomerCode,
    providerSubaccountCode: account.providerSubaccountCode,
    userId,
  });
  if (
    written.customerId !== customerId ||
    written.merchantId !== merchantId ||
    written.provider !== 'paystack' ||
    written.status !== 'active'
  ) {
    throw new CustomerWalletPaymentAccountError(
      'WALLET_DVA_STORAGE_ERROR',
      'Wallet DVA writer returned an invalid owner binding'
    );
  }
  return written;
}
