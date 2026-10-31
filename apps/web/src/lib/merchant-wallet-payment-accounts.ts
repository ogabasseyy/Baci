import type { SupabaseClient } from '@supabase/supabase-js';
import { createDedicatedAccount, createOrGetCustomer } from '@/lib/paystack';
import { merchantWalletFundingAccountRowsSchema } from '@/schemas/merchant-wallet-funding';
import { isAmbiguousPaystackProvisioningFailure } from './is-ambiguous-paystack-provisioning-failure';
import { logMerchantWalletProvisioningError } from './merchant-wallet-provisioning-logging';
import { resumeMerchantWalletFundingRequest } from './resume-merchant-wallet-funding-request';

export type MerchantWalletAccount = {
  accountName: string | null;
  accountNumber: string;
  bankName: string | null;
  currency: 'NGN';
  status: 'active' | 'pending' | 'disabled';
};

// The DEFINER projection admits the owner and orders.fulfill staff and returns
// only these safe columns; provider identifiers and metadata stay owner-RLS.
async function readFundingAccountRows(
  supabase: SupabaseClient,
  merchantId: string
) {
  const { data, error } = await supabase.rpc(
    'get_merchant_wallet_funding_account',
    { p_merchant_id: merchantId }
  );
  if (error) throw error;
  const parsed = merchantWalletFundingAccountRowsSchema.safeParse(data ?? []);
  if (!parsed.success) throw new Error('INVALID_FUNDING_ACCOUNT_ROWS');
  return parsed.data;
}

function singleRow<T>(rows: T[]): T | null {
  // Mirrors maybeSingle(): more than one live account is a data fault.
  if (rows.length > 1) throw new Error('MULTIPLE_FUNDING_ACCOUNTS');
  return rows[0] ?? null;
}

export async function getMerchantWalletAccount(
  supabase: SupabaseClient,
  merchantId: string
): Promise<MerchantWalletAccount | null> {
  const data = singleRow(await readFundingAccountRows(supabase, merchantId));
  if (!data) return null;
  return {
    accountName: data.account_name,
    accountNumber: data.account_number,
    bankName: data.bank_name,
    currency: 'NGN',
    status: data.status,
  };
}

export async function requestMerchantWalletAccount(
  supabase: SupabaseClient,
  merchant: {
    id: string;
    email: string;
    firstName?: string;
    lastName?: string;
    phone?: string;
  }
) {
  const existing = singleRow(
    (await readFundingAccountRows(supabase, merchant.id)).filter(
      (row) => row.status === 'active'
    )
  );
  if (existing)
    return {
      status: 'active' as const,
      account: {
        accountName: existing.account_name,
        accountNumber: existing.account_number,
        bankName: existing.bank_name,
        currency: 'NGN' as const,
        status: 'active' as const,
      },
    };
  const { data: request, error } = await supabase
    .from('merchant_wallet_funding_account_requests')
    .insert({
      merchant_id: merchant.id,
      consented_at: new Date().toISOString(),
      status: 'pending',
    })
    .select('id, status')
    .single();
  if (error) {
    const pending = await supabase
      .from('merchant_wallet_funding_account_requests')
      .select('id, created_at')
      .eq('merchant_id', merchant.id)
      .eq('status', 'pending')
      .maybeSingle();
    if (pending.data) {
      return resumeMerchantWalletFundingRequest(
        supabase,
        merchant,
        pending.data
      );
    }
    throw error;
  }
  const failProvisioningRequest = async (fallback: string): Promise<never> => {
    try {
      const { error: transitionError } = await supabase.rpc(
        'fail_merchant_wallet_funding_request',
        {
          p_request_id: request.id,
          p_merchant_id: merchant.id,
        }
      );
      if (transitionError) throw transitionError;
    } catch (transitionError: unknown) {
      logMerchantWalletProvisioningError(
        'Failed to mark merchant wallet funding request failed',
        request.id,
        merchant.id,
        transitionError
      );
      throw new Error('FUNDING_REQUEST_REVIEW_REQUIRED');
    }
    throw new Error(fallback);
  };

  let customer: Awaited<ReturnType<typeof createOrGetCustomer>>;
  try {
    customer = await createOrGetCustomer({
      email: merchant.email,
      first_name: merchant.firstName,
      last_name: merchant.lastName,
      phone: merchant.phone,
      metadata: {
        request_id: request.id,
        merchant_id: merchant.id,
        source: 'merchant_wallet_funding',
      },
    });
  } catch (provisioningError: unknown) {
    logMerchantWalletProvisioningError(
      'Merchant wallet customer provisioning failed',
      request.id,
      merchant.id,
      provisioningError
    );
    if (isAmbiguousPaystackProvisioningFailure(provisioningError)) {
      return {
        status: 'pending' as const,
        account: null,
        requestId: request.id,
      };
    }
    return failProvisioningRequest('Paystack customer provisioning failed');
  }
  if (!customer.success) {
    if (isAmbiguousPaystackProvisioningFailure(customer)) {
      return {
        status: 'pending' as const,
        account: null,
        requestId: request.id,
      };
    }
    return failProvisioningRequest('Paystack customer provisioning failed');
  }
  let dva: Awaited<ReturnType<typeof createDedicatedAccount>>;
  try {
    dva = await createDedicatedAccount(customer.data.customer_code, {
      firstName: merchant.firstName,
      lastName: merchant.lastName,
      phone: merchant.phone,
      metadata: {
        request_id: request.id,
        merchant_id: merchant.id,
        source: 'merchant_wallet_funding',
      },
    });
  } catch (provisioningError: unknown) {
    logMerchantWalletProvisioningError(
      'Merchant wallet DVA provisioning failed',
      request.id,
      merchant.id,
      provisioningError
    );
    if (isAmbiguousPaystackProvisioningFailure(provisioningError)) {
      return {
        status: 'pending' as const,
        account: null,
        requestId: request.id,
      };
    }
    return failProvisioningRequest('Paystack DVA provisioning failed');
  }
  if (!dva.success) {
    if (isAmbiguousPaystackProvisioningFailure(dva)) {
      return {
        status: 'pending' as const,
        account: null,
        requestId: request.id,
      };
    }
    return failProvisioningRequest('Paystack DVA provisioning failed');
  }
  return { status: 'pending' as const, account: null, requestId: request.id };
}

export async function persistVerifiedMerchantWalletAssignment(
  supabase: SupabaseClient,
  payload: {
    requestId: string;
    merchantId: string;
    accountNumber: string;
    accountName: string | null;
    bankName: string | null;
    currency: string;
    providerAccountId?: string | null;
    providerCustomerCode?: string | null;
  }
) {
  const { data, error } = await supabase.rpc(
    'persist_merchant_wallet_payment_account',
    {
      p_request_id: payload.requestId,
      p_merchant_id: payload.merchantId,
      p_account_number: payload.accountNumber,
      p_account_name: payload.accountName,
      p_bank_name: payload.bankName,
      p_currency: payload.currency,
      p_provider_account_id: payload.providerAccountId ?? null,
      p_provider_customer_code: payload.providerCustomerCode ?? null,
    }
  );
  if (error) throw error;
  return data;
}
