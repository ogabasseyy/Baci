import type { SupabaseClient } from '@supabase/supabase-js';
import { cacheLife, cacheTag } from 'next/cache';
import { getPublicSupabaseClient } from '@/lib/public-supabase-client';
import { isValidMerchantIdentifier } from '@/lib/validation';
import type {
  StorefrontDatabase,
  StorefrontMerchantSnapshotRow,
} from '@/types/storefront-database';
import { readStorefrontMerchantSnapshot } from '../storefront-merchant-snapshot';
import {
  StorefrontReadUnavailableError,
  unwrapStorefrontReadResultForCache,
} from '../storefront-read-result';

export interface CompareMerchant {
  custom_domain: string | null;
  id: string;
  is_published: boolean | null;
  slug: string;
}

function normalizeCompareMerchant(
  row: StorefrontMerchantSnapshotRow
): CompareMerchant | null {
  if (
    !row.merchant_data ||
    typeof row.merchant_data !== 'object' ||
    Array.isArray(row.merchant_data)
  ) {
    return null;
  }

  const merchant = row.merchant_data as Record<string, unknown>;
  if (typeof merchant.id !== 'string' || typeof merchant.slug !== 'string') {
    return null;
  }

  return {
    custom_domain:
      row.custom_domain ??
      (typeof merchant.custom_domain === 'string'
        ? merchant.custom_domain
        : null),
    id: merchant.id,
    is_published:
      typeof merchant.is_published === 'boolean' ? merchant.is_published : null,
    slug: merchant.slug,
  };
}

async function getCachedCompareMerchant(
  identifier: string
): Promise<CompareMerchant | null> {
  'use cache';
  cacheLife('merchant');
  cacheTag(
    'merchants',
    'domains',
    `merchant-${identifier}`,
    `domain-${identifier}`
  );

  const row = unwrapStorefrontReadResultForCache(
    await readStorefrontMerchantSnapshot(
      getPublicSupabaseClient() as unknown as SupabaseClient<StorefrontDatabase>,
      identifier
    )
  );
  if (!row) return null;

  const merchant = normalizeCompareMerchant(row);
  if (!merchant) {
    throw new StorefrontReadUnavailableError({
      kind: 'integrity',
      operation: 'merchant_snapshot',
      retryable: false,
    });
  }

  cacheTag(
    `features-${merchant.id}`,
    `merchant-${merchant.slug}`,
    ...(merchant.custom_domain
      ? [`domain-${merchant.custom_domain.toLowerCase()}`]
      : [])
  );
  return merchant;
}

export async function getCachedCompareMerchantByIdentifier(
  identifier: string
): Promise<CompareMerchant | null> {
  if (!isValidMerchantIdentifier(identifier)) return null;

  const normalizedIdentifier = identifier.toLowerCase();
  return await getCachedCompareMerchant(normalizedIdentifier);
}
