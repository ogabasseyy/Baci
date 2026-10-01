import type { SupabaseClient } from '@supabase/supabase-js';
import {
  persistWalletPaymentAccount,
  resolveCustomerWalletPaymentAccount,
} from '@/lib/customer-wallet-payment-account-db';
import {
  CUSTOMER_NAME_REQUIRED_MESSAGE,
  type CustomerWalletPaymentAccount,
  CustomerWalletPaymentAccountError,
  type CustomerWalletPaymentCustomer,
  type CustomerWalletPaymentMerchant,
} from '@/lib/customer-wallet-payment-account-types';
import {
  createDedicatedAccountForWallet,
  createOrGetCustomer,
  type DedicatedAccountResponse,
  extractPaystackSplitConfigSubaccount,
  getDedicatedAccounts,
  type WalletDedicatedAccount,
} from '@/lib/paystack';

export {
  findCustomerWalletPaymentAccountByReceiver,
  normalizeWalletPaymentAccount,
  resolveCustomerWalletPaymentAccount,
} from '@/lib/customer-wallet-payment-account-db';
export type {
  CustomerWalletPaymentAccount,
  CustomerWalletPaymentAccountErrorCode,
  CustomerWalletPaymentCustomer,
  CustomerWalletPaymentMerchant,
} from '@/lib/customer-wallet-payment-account-types';
export { CustomerWalletPaymentAccountError } from '@/lib/customer-wallet-payment-account-types';

function getMerchantPaystackSubaccount(
  merchant: CustomerWalletPaymentMerchant
) {
  const subaccount = merchant.paystack_subaccount_code?.trim() ?? '';
  if (!/^ACCT_[A-Za-z0-9]+$/.test(subaccount)) {
    throw new CustomerWalletPaymentAccountError(
      'GATEWAY_NOT_CONFIGURED',
      'Merchant Paystack subaccount is not configured'
    );
  }

  return subaccount;
}

function getRequiredCustomerPhone(customer: CustomerWalletPaymentCustomer) {
  const phone = customer.phone?.trim() ?? '';
  if (!phone) {
    throw new CustomerWalletPaymentAccountError(
      'CUSTOMER_PHONE_REQUIRED',
      'Add a phone number before creating a wallet transfer account'
    );
  }

  return phone;
}

function getRequiredCustomerEmail(customer: CustomerWalletPaymentCustomer) {
  const customerEmail = customer.email?.trim();
  if (!customerEmail) {
    throw new CustomerWalletPaymentAccountError(
      'PAYSTACK_CUSTOMER_ERROR',
      'Customer email is required to create a Paystack wallet DVA'
    );
  }

  return customerEmail;
}

function getOptionalCustomerName(value: string | null | undefined) {
  const name = value?.trim();
  return name || undefined;
}

function getRequiredCustomerNames({
  customer,
  paystackCustomer,
}: {
  customer: CustomerWalletPaymentCustomer;
  paystackCustomer: { first_name: string | null; last_name: string | null };
}) {
  const localFirstName = getOptionalCustomerName(customer.first_name);
  const localLastName = getOptionalCustomerName(customer.last_name);
  const providerFirstName = getOptionalCustomerName(
    paystackCustomer.first_name
  );
  const providerLastName = getOptionalCustomerName(paystackCustomer.last_name);

  if (localFirstName && localLastName) {
    return { firstName: localFirstName, lastName: localLastName };
  }

  if (providerFirstName && providerLastName) {
    return { firstName: providerFirstName, lastName: providerLastName };
  }

  throw new CustomerWalletPaymentAccountError(
    'CUSTOMER_NAME_REQUIRED',
    CUSTOMER_NAME_REQUIRED_MESSAGE
  );
}

function normalizePaystackWalletDedicatedAccount({
  account,
  expectedSubaccount,
  fallbackCustomerCode,
}: {
  account: DedicatedAccountResponse;
  expectedSubaccount: string;
  fallbackCustomerCode: string;
}): WalletDedicatedAccount | null {
  const provenSubaccount = extractPaystackSplitConfigSubaccount(
    account.split_config
  );
  if (provenSubaccount !== expectedSubaccount) {
    return null;
  }

  if (
    !account.active ||
    account.assigned === false ||
    account.currency !== 'NGN' ||
    !/^\d{10}$/.test(account.account_number)
  ) {
    return null;
  }

  return {
    accountName: account.account_name,
    accountNumber: account.account_number,
    bankName: account.bank.name,
    bankSlug: account.bank.slug ?? null,
    currency: 'NGN',
    providerAccountId:
      account.id === undefined || account.id === null
        ? null
        : String(account.id),
    providerCustomerCode:
      account.customer.customer_code || fallbackCustomerCode,
    providerSubaccountCode: provenSubaccount,
  };
}

async function resolveExistingPaystackWalletDva({
  customerCode,
  expectedSubaccount,
}: {
  customerCode: string;
  expectedSubaccount: string;
}) {
  const existingAccounts = await getDedicatedAccounts(customerCode);
  if (!existingAccounts.success) {
    throw new CustomerWalletPaymentAccountError(
      'PAYSTACK_DVA_ERROR',
      existingAccounts.error
    );
  }

  for (const account of existingAccounts.data) {
    const walletAccount = normalizePaystackWalletDedicatedAccount({
      account,
      expectedSubaccount,
      fallbackCustomerCode: customerCode,
    });
    if (walletAccount) {
      return walletAccount;
    }
  }

  return null;
}

export async function ensureCustomerWalletPaymentAccount({
  consentedAt,
  customer,
  merchant,
  supabase,
}: {
  consentedAt: Date;
  customer: CustomerWalletPaymentCustomer;
  merchant: CustomerWalletPaymentMerchant;
  supabase: SupabaseClient;
}): Promise<CustomerWalletPaymentAccount> {
  const merchantSubaccount = getMerchantPaystackSubaccount(merchant);

  const existingAccount = await resolveCustomerWalletPaymentAccount({
    customerId: customer.id,
    merchantId: merchant.id,
    supabase,
  });

  if (existingAccount) {
    if (existingAccount.status !== 'active') {
      throw new CustomerWalletPaymentAccountError(
        'WALLET_DVA_STORAGE_ERROR',
        'Existing wallet DVA is not active'
      );
    }

    if (existingAccount.providerSubaccountCode !== merchantSubaccount) {
      throw new CustomerWalletPaymentAccountError(
        'WALLET_DVA_SUBACCOUNT_CONFLICT',
        'Existing wallet DVA belongs to a different Paystack subaccount'
      );
    }

    return existingAccount;
  }

  const customerEmail = getRequiredCustomerEmail(customer);
  const customerPhone = getRequiredCustomerPhone(customer);

  const paystackCustomer = await createOrGetCustomer({
    email: customerEmail,
    first_name: getOptionalCustomerName(customer.first_name),
    last_name: getOptionalCustomerName(customer.last_name),
    phone: customerPhone,
    metadata: {
      customer_id: customer.id,
      merchant_id: merchant.id,
      source: 'wallet_dva',
    },
  });

  if (!paystackCustomer.success) {
    throw new CustomerWalletPaymentAccountError(
      'PAYSTACK_CUSTOMER_ERROR',
      paystackCustomer.error
    );
  }

  const existingPaystackDva = await resolveExistingPaystackWalletDva({
    customerCode: paystackCustomer.data.customer_code,
    expectedSubaccount: merchantSubaccount,
  });

  if (existingPaystackDva) {
    return persistWalletPaymentAccount({
      account: existingPaystackDva,
      consentedAt,
      customerId: customer.id,
      merchantId: merchant.id,
      supabase,
    });
  }

  const dedicatedAccount = await createDedicatedAccountForWallet({
    customerCode: paystackCustomer.data.customer_code,
    ...getRequiredCustomerNames({
      customer,
      paystackCustomer: paystackCustomer.data,
    }),
    phone: customerPhone,
    subaccount: merchantSubaccount,
  });

  if (!dedicatedAccount.success) {
    throw new CustomerWalletPaymentAccountError(
      'PAYSTACK_DVA_ERROR',
      dedicatedAccount.error
    );
  }

  return persistWalletPaymentAccount({
    account: dedicatedAccount.data,
    consentedAt,
    customerId: customer.id,
    merchantId: merchant.id,
    supabase,
  });
}
