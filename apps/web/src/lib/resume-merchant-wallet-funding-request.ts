import type { SupabaseClient } from '@supabase/supabase-js';
import {
  createOrGetCustomer,
  type DedicatedAccountResponse,
  getDedicatedAccounts,
} from '@/lib/paystack';
import { createMerchantWalletFundingRecoveryAttestation } from './merchant-wallet-funding-recovery-attestation';
import { logMerchantWalletProvisioningError } from './merchant-wallet-provisioning-logging';

const STALE_PENDING_MS = 15 * 60 * 1000;

type MerchantIdentity = {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
};

function metadataMatchesRequest(
  metadata: Record<string, unknown> | null | undefined,
  requestId: string
): boolean {
  if (!metadata || typeof metadata !== 'object') return false;
  return (
    metadata.source === 'merchant_wallet_funding' &&
    metadata.request_id === requestId
  );
}

export function pickRecoverableFundingAccount(
  accounts: DedicatedAccountResponse[] | undefined,
  request: { id: string; created_at?: string | null }
): DedicatedAccountResponse | null {
  if (!accounts?.length) return null;
  const candidates = accounts.filter(
    (account) =>
      account.active === true &&
      account.assigned === true &&
      account.currency === 'NGN' &&
      /^\d{10,20}$/.test(account.account_number) &&
      metadataMatchesRequest(account.metadata, request.id)
  );
  return candidates.length === 1 ? candidates[0] : null;
}

export async function resumeMerchantWalletFundingRequest(
  supabase: SupabaseClient,
  merchant: MerchantIdentity,
  request: { id: string; created_at?: string | null }
): Promise<
  | {
      status: 'active';
      account: {
        accountName: string | null;
        accountNumber: string;
        bankName: string | null;
        currency: 'NGN';
        status: 'active';
      };
    }
  | { status: 'pending'; account: null; requestId: string }
> {
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
  } catch (error: unknown) {
    logMerchantWalletProvisioningError(
      'Merchant wallet funding recovery customer lookup failed',
      request.id,
      merchant.id,
      error
    );
    return { status: 'pending', account: null, requestId: request.id };
  }
  if (!customer.success) {
    return { status: 'pending', account: null, requestId: request.id };
  }

  const existing = await getDedicatedAccounts(customer.data.customer_code);
  if (!existing.success) {
    // Authoritative listing failed: keep the pending request so a later consent
    // can probe again instead of provisioning a second DVA.
    return { status: 'pending', account: null, requestId: request.id };
  }

  const account = pickRecoverableFundingAccount(existing.data, request);
  if (account) {
    const attestedAt = new Date();
    const attestedAtIso = attestedAt.toISOString();
    const providerAccountId = String(account.id);
    const providerCustomerCode = account.customer?.customer_code ?? null;
    const accountName = account.account_name ?? null;
    const bankName = account.bank?.name ?? null;
    const attestation = createMerchantWalletFundingRecoveryAttestation({
      requestId: request.id,
      merchantId: merchant.id,
      accountNumber: account.account_number,
      accountName,
      bankName,
      currency: 'NGN',
      providerAccountId,
      providerCustomerCode,
      attestedAtIso,
    });
    const { data: persisted, error: persistError } = await supabase.rpc(
      'complete_merchant_wallet_funding_recovery',
      {
        p_request_id: request.id,
        p_merchant_id: merchant.id,
        p_account_number: account.account_number,
        p_account_name: accountName,
        p_bank_name: bankName,
        p_currency: 'NGN',
        p_provider_account_id: providerAccountId,
        p_provider_customer_code: providerCustomerCode,
        p_attested_at: attestedAtIso,
        p_attested_at_iso: attestedAtIso,
        p_attestation: attestation,
      }
    );
    if (persistError) throw persistError;
    return {
      status: 'active',
      account: {
        accountName:
          typeof persisted?.account_name === 'string'
            ? persisted.account_name
            : accountName,
        accountNumber: account.account_number,
        bankName:
          typeof persisted?.bank_name === 'string'
            ? persisted.bank_name
            : bankName,
        currency: 'NGN',
        status: 'active',
      },
    };
  }

  const createdAtMs = Date.parse(String(request.created_at ?? ''));
  const isStale =
    Number.isFinite(createdAtMs) &&
    Date.now() - createdAtMs >= STALE_PENDING_MS;
  if (isStale) {
    const { error } = await supabase.rpc(
      'fail_merchant_wallet_funding_request',
      {
        p_request_id: request.id,
        p_merchant_id: merchant.id,
      }
    );
    if (error) {
      logMerchantWalletProvisioningError(
        'Failed to expire stale merchant wallet funding request',
        request.id,
        merchant.id,
        error
      );
      throw new Error('FUNDING_REQUEST_REVIEW_REQUIRED');
    }
    throw new Error('FUNDING_REQUEST_EXPIRED_RETRY');
  }

  return { status: 'pending', account: null, requestId: request.id };
}
