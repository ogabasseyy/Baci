export const WALLET_PAYMENT_ACCOUNT_SELECT =
  'id, merchant_id, customer_id, provider, provider_customer_code, provider_subaccount_code, provider_account_id, account_number, account_name, bank_name, bank_slug, currency, status, metadata, consented_at';

export const CUSTOMER_NAME_REQUIRED_MESSAGE =
  'Add your first and last name before creating a wallet transfer account';

export type CustomerWalletPaymentAccountErrorCode =
  | 'CUSTOMER_NAME_REQUIRED'
  | 'CUSTOMER_PHONE_REQUIRED'
  | 'GATEWAY_NOT_CONFIGURED'
  | 'PAYSTACK_CUSTOMER_ERROR'
  | 'PAYSTACK_DVA_ERROR'
  | 'WALLET_DVA_DISABLED_ACCOUNT'
  | 'WALLET_DVA_ORDER_ALIAS_CONFLICT'
  | 'WALLET_DVA_PENDING_REVIEW_CONFLICT'
  | 'WALLET_DVA_RECEIVER_CONFLICT'
  | 'WALLET_DVA_SUBACCOUNT_CONFLICT'
  | 'WALLET_DVA_STORAGE_ERROR';

export class CustomerWalletPaymentAccountError extends Error {
  code: CustomerWalletPaymentAccountErrorCode;

  constructor(code: CustomerWalletPaymentAccountErrorCode, message: string) {
    super(message);
    this.name = 'CustomerWalletPaymentAccountError';
    this.code = code;
  }
}

export interface CustomerWalletPaymentMerchant {
  business_name?: string | null;
  id: string;
  paystack_subaccount_code?: string | null;
}

export interface CustomerWalletPaymentCustomer {
  email?: string | null;
  first_name?: string | null;
  id: string;
  last_name?: string | null;
  phone?: string | null;
}

export interface CustomerWalletPaymentAccount {
  accountName: string;
  accountNumber: string;
  bankName: string;
  bankSlug: string | null;
  consentedAt: string;
  currency: 'NGN';
  customerId: string;
  id: string;
  merchantId: string;
  metadata: Record<string, unknown>;
  provider: 'paystack';
  providerAccountId: string | null;
  providerCustomerCode: string;
  providerSubaccountCode: string;
  status: 'active' | 'disabled' | 'pending_review';
}

export interface CustomerWalletPaymentAccountRow {
  account_name: string;
  account_number: string;
  bank_name: string;
  bank_slug: string | null;
  consented_at: string;
  currency: string;
  customer_id: string;
  id: string;
  merchant_id: string;
  metadata: Record<string, unknown> | null;
  provider: string;
  provider_account_id: string | null;
  provider_customer_code: string;
  provider_subaccount_code: string;
  status: string;
}

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
