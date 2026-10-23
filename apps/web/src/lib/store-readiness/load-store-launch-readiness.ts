import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  getReadinessLaunchPaymentRequirement,
  requiresNigerianKycForLaunch,
} from '@/lib/checkout/payment-gateway-availability';
import { fetchMerchantIdentityVerified } from '@/lib/fetch-merchant-identity-verified';
import { fetchMerchantPaystackConfigured } from '@/lib/fetch-merchant-paystack-configured';
import type { Database } from '@/types/supabase';
import {
  buildStoreLaunchReadiness,
  type StoreLaunchFacts,
  type StoreLaunchReadiness,
} from './build-store-launch-readiness';

export interface LoadStoreLaunchReadinessInput {
  supabase: SupabaseClient<Database>;
  merchantId: string;
}

/** Server-internal launch facts retained so the full loader does not re-query. */
export interface LoadedStoreLaunchReadiness extends StoreLaunchReadiness {
  facts: StoreLaunchFacts;
}

function throwQueryError(source: string, error: { message: string }): never {
  throw new Error(`Failed to load ${source}: ${error.message}`);
}

/**
 * Loads only the RLS-authorized facts shared by publication and readiness.
 * The supplied client must already hold the authenticated caller's session.
 */
export async function loadStoreLaunchReadiness({
  supabase,
  merchantId,
}: LoadStoreLaunchReadinessInput): Promise<LoadedStoreLaunchReadiness> {
  const [
    merchantResult,
    featureSettingsResult,
    activeProductResult,
    totalProductResult,
    paystackConfigured,
  ] = await Promise.all([
    supabase
      .from('merchants')
      .select(
        'slug, country, payout_currency, email, phone, support_email, support_phone, bank_code, bank_account_number'
      )
      .eq('id', merchantId)
      .maybeSingle(),
    supabase
      .from('merchant_feature_settings')
      .select('paystack_enabled, korapay_enabled, pay_on_delivery_enabled')
      .eq('merchant_id', merchantId)
      .maybeSingle(),
    supabase
      .from('products')
      .select('id', { count: 'exact', head: true })
      .eq('merchant_id', merchantId)
      .eq('status', 'active'),
    supabase
      .from('products')
      .select('id', { count: 'exact', head: true })
      .eq('merchant_id', merchantId),
    fetchMerchantPaystackConfigured(supabase, merchantId),
  ]);

  if (merchantResult.error) {
    throwQueryError('merchant launch settings', merchantResult.error);
  }
  if (!merchantResult.data) {
    throw new Error(
      'Failed to load merchant launch settings: merchant not found'
    );
  }
  if (featureSettingsResult.error) {
    throwQueryError('merchant payment settings', featureSettingsResult.error);
  }
  if (activeProductResult.error) {
    throwQueryError('active product count', activeProductResult.error);
  }
  if (totalProductResult.error) {
    throwQueryError('total product count', totalProductResult.error);
  }

  const merchant = {
    ...merchantResult.data,
    feature_settings: featureSettingsResult.data ?? undefined,
    paystack_subaccount_configured: paystackConfigured,
  };
  const kycRequired = requiresNigerianKycForLaunch(merchant);
  const hasVerifiedIdentity = kycRequired
    ? await fetchMerchantIdentityVerified(supabase, merchantId)
    : false;
  const paymentRequirement = getReadinessLaunchPaymentRequirement(merchant);

  const facts: StoreLaunchFacts = {
    merchantId,
    slug: merchant.slug,
    country: merchant.country,
    supportEmail: merchant.support_email,
    supportPhone: merchant.support_phone,
    merchantEmail: merchant.email,
    merchantPhone: merchant.phone,
    activeProductCount: activeProductResult.count ?? 0,
    totalProductCount: totalProductResult.count ?? 0,
    kycRequired,
    hasVerifiedIdentity,
    paymentRequirement,
  };

  return {
    ...buildStoreLaunchReadiness(facts),
    facts,
  };
}
