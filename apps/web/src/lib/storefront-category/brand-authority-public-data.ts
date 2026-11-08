import { cacheLife, cacheTag } from 'next/cache';
import { readStorefrontMerchantSnapshot } from '@/lib/storefront-merchant-snapshot';
import { unwrapStorefrontReadResultForCache } from '@/lib/storefront-read-result';
import { createPublicClient } from '@/lib/supabase/public';
import { isValidMerchantIdentifier } from '@/lib/validation';

export interface BrandAuthorityMerchant {
  business_name: string;
  country?: string;
  custom_domain?: string;
  id: string;
  payout_currency: string;
  slug: string;
}

export interface BrandAuthorityCategory {
  id: string;
  name: string;
}

function getClient(signal?: AbortSignal) {
  return createPublicClient({
    clientInfo: 'baci-web-brand-authority',
    timeoutMs: 10_000,
    signal,
  });
}

async function getCachedMerchant(
  identifier: string
): Promise<BrandAuthorityMerchant | null> {
  'use cache';
  cacheLife('merchant');
  cacheTag('merchants', `merchant-${identifier}`, `domain-${identifier}`);

  const row = unwrapStorefrontReadResultForCache(
    await readStorefrontMerchantSnapshot(getClient(), identifier)
  );
  if (!row) return null;
  if (
    row.resolution_status !== 'found' ||
    !row.merchant_data ||
    typeof row.merchant_data !== 'object' ||
    Array.isArray(row.merchant_data)
  ) {
    throw new Error('Invalid storefront merchant snapshot');
  }

  const merchant = row.merchant_data as Record<string, unknown>;
  if (
    typeof merchant.id !== 'string' ||
    typeof merchant.slug !== 'string' ||
    typeof merchant.business_name !== 'string'
  ) {
    throw new Error('Invalid storefront merchant identity');
  }

  cacheTag(`merchant-${merchant.slug}`);
  return {
    business_name: merchant.business_name,
    country:
      typeof merchant.country === 'string' ? merchant.country : undefined,
    custom_domain:
      typeof row.custom_domain === 'string' ? row.custom_domain : undefined,
    id: merchant.id,
    payout_currency:
      typeof merchant.payout_currency === 'string'
        ? merchant.payout_currency
        : 'NGN',
    slug: merchant.slug,
  };
}

async function getMerchant(
  identifier: string
): Promise<BrandAuthorityMerchant | null> {
  if (!isValidMerchantIdentifier(identifier)) return null;
  return await getCachedMerchant(identifier.toLowerCase());
}

async function getCategory(
  merchantId: string,
  categorySlug: string
): Promise<BrandAuthorityCategory | null> {
  'use cache';
  cacheLife('storefront-page');
  cacheTag('categories', `categories-${merchantId}`);
  return await readCategory(merchantId, categorySlug);
}

async function readCategory(
  merchantId: string,
  categorySlug: string,
  signal?: AbortSignal
): Promise<BrandAuthorityCategory | null> {
  const { data, error } = await getClient(signal)
    .from('categories')
    .select('id, name, is_active')
    .eq('merchant_id', merchantId)
    .eq('slug', categorySlug)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.is_active === false) return null;
  if (typeof data.id !== 'string' || typeof data.name !== 'string') {
    throw new Error('Invalid storefront category record');
  }

  return { id: data.id, name: data.name };
}

export const brandAuthorityPublicData = {
  createClient: getClient,
  getCategory,
  readCategory,
  getMerchant,
} as const;
