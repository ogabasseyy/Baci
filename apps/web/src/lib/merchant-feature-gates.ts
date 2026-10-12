import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import {
  type MerchantFeatureGate,
  merchantHasFeature,
} from './merchant-has-feature';

export type { MerchantFeatureGate } from './merchant-has-feature';
export { merchantHasFeature } from './merchant-has-feature';

const FEATURE_MESSAGES: Record<MerchantFeatureGate, string> = {
  custom_domain: 'Custom domains require Baci Starter or higher',
  growth_integrations: 'Growth integrations require Baci Pro',
  marketplace_sync: 'Marketplace sync requires Baci Pro',
  shared_cart: 'Shared cart is not enabled for this store',
  shared_cart_realtime:
    'Shared cart live updates are not enabled for this store',
};
export const MERCHANT_FEATURE_GATE_SELECT =
  'id, plan_tier, plan_expires_at, premium_features';

export async function getMerchantFeatureAccess(
  supabase: SupabaseClient,
  merchantId: string,
  feature: MerchantFeatureGate
) {
  const { data: merchant, error } = await supabase
    .from('merchants')
    .select(MERCHANT_FEATURE_GATE_SELECT)
    .eq('id', merchantId)
    .single();

  if (error || !merchant) {
    return { allowed: false, error };
  }

  return {
    allowed: merchantHasFeature(merchant, feature),
    error: null,
  };
}

export async function requireMerchantFeatureAccess(
  supabase: SupabaseClient,
  merchantId: string,
  feature: MerchantFeatureGate
): Promise<NextResponse | null> {
  const featureAccess = await getMerchantFeatureAccess(
    supabase,
    merchantId,
    feature
  );

  if (featureAccess.error) {
    console.error('Failed to verify merchant feature access:', {
      error: featureAccess.error,
      feature,
      merchantId,
    });
    return NextResponse.json(
      { error: 'Failed to verify merchant plan' },
      { status: 500 }
    );
  }

  if (!featureAccess.allowed) {
    return merchantFeatureUpgradeResponse(feature);
  }

  return null;
}

export function merchantFeatureUpgradeResponse(feature: MerchantFeatureGate) {
  return NextResponse.json(
    {
      code: 'requires_upgrade',
      error: FEATURE_MESSAGES[feature],
    },
    { status: 402 }
  );
}
