import { cacheLife, cacheTag } from 'next/cache';
import {
  getCachedFeatureSettings,
  getCachedMerchantPaystackSubaccountConfigured,
} from '@/lib/cached-data';
import { logger } from '@/lib/logger';
import { createAnonClient } from '@/lib/supabase/anon';
import {
  buildPublicStorefrontFeatures,
  type StorefrontFeatures,
  type StorefrontFeaturesLookupResult,
} from './storefront-features-projection';

export type { StorefrontFeatures, StorefrontFeaturesLookupResult };

type CachedMerchantAndSettingsResult =
  | {
      status: 200;
      merchant: {
        id: string;
        country: string | null;
        business_type: string | null;
      };
      settings: Record<string, unknown>;
    }
  | { status: 404 };

async function getCachedMerchantAndSettings({
  merchantId,
  slug,
}: {
  merchantId?: string;
  slug?: string;
}): Promise<CachedMerchantAndSettingsResult> {
  'use cache';

  cacheLife('merchant');
  cacheTag('merchants');
  if (merchantId) {
    cacheTag(`merchant-id-${merchantId}`, `merchant-features-${merchantId}`);
  }
  if (slug) {
    cacheTag(`merchant-${slug}`);
  }

  const supabase = createAnonClient();
  let merchantLookupQuery = supabase
    .from('merchants')
    .select('id, country, business_type');
  if (slug) {
    merchantLookupQuery = merchantLookupQuery.eq('slug', slug);
  } else if (merchantId) {
    merchantLookupQuery = merchantLookupQuery.eq('id', merchantId);
  } else {
    return { status: 404 };
  }
  const merchantLookup = await merchantLookupQuery.single();

  if (merchantLookup.error) {
    if (merchantLookup.error.code === 'PGRST116') {
      return { status: 404 };
    }

    logger.error({
      message: 'Storefront features merchant lookup failed',
      error: merchantLookup.error,
      merchantId,
      slug,
    });
    throw new Error(
      `Storefront features merchant lookup failed: ${merchantLookup.error.message}`
    );
  }

  const merchant = merchantLookup.data;
  if (!merchant) {
    return { status: 404 };
  }

  cacheTag(`merchant-id-${merchant.id}`, `merchant-features-${merchant.id}`);
  const settings = ((await getCachedFeatureSettings(merchant.id)) ??
    {}) as Record<string, unknown>;

  return {
    status: 200,
    merchant,
    settings,
  };
}

export async function getStorefrontFeatures({
  merchantId,
  slug,
}: {
  merchantId?: string;
  slug?: string;
}): Promise<StorefrontFeaturesLookupResult> {
  const cached = await getCachedMerchantAndSettings({ merchantId, slug });
  if (cached.status === 404) {
    return { status: 404 };
  }

  let paystackSubaccountConfigured = false;
  let degraded = false;
  try {
    paystackSubaccountConfigured =
      await getCachedMerchantPaystackSubaccountConfigured(cached.merchant.id);
  } catch (error) {
    // Fail closed outside 'use cache' and mark degraded so transient RPC
    // failures are never cached as normal public output.
    degraded = true;
    logger.error({
      message: 'Storefront features paystack subaccount lookup failed',
      error,
      merchantId,
      slug,
    });
  }

  return {
    status: 200,
    merchantId: cached.merchant.id,
    features: buildPublicStorefrontFeatures({
      merchant: cached.merchant,
      settings: cached.settings,
      paystackSubaccountConfigured,
    }),
    degraded,
  };
}
