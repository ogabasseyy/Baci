import type { SupabaseClient } from '@supabase/supabase-js';
import { createDedicatedAccount, createOrGetCustomer } from '@/lib/paystack';
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

export async function getMerchantWalletAccount(
  supabase: SupabaseClient,
  merchantId: string
): Promise<MerchantWalletAccount | null> {
  const { data, error } = await supabase
    .from('merchant_wallet_payment_accounts')
    .select('account_name, account_number, bank_name, currency, status')
    .eq('merchant_id', merchantId)
    .in('status', ['active', 'pending'])
    .maybeSingle();
  if (error) throw error;
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
  const { data: existing, error: existingError } = await supabase
    .from('merchant_wallet_payment_accounts')
    .select('account_name, account_number, bank_name, currency, status')
    .eq('merchant_id', merchant.id)
    .eq('status', 'active')
    .maybeSingle();
  if (existingError) throw existingError;
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
