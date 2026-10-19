import { createStorefrontReadDeadline } from '@/lib/create-storefront-read-deadline';
import {
  prepareStorefrontSingleAttemptQuery,
  type StorefrontSingleAttemptQuery,
} from '@/lib/prepare-storefront-single-attempt-query';
import { getPublicSupabaseClient } from '@/lib/public-supabase-client';

export type StorefrontComparisonRevision = string;
const STOREFRONT_COMPARISON_REVISION_TIMEOUT_MS = 3_000;

function normalizeRevision(
  value: unknown
): StorefrontComparisonRevision | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? String(value) : null;
  }

  return typeof value === 'string' && /^[1-9][0-9]*$/.test(value)
    ? value
    : null;
}

/**
 * Reads the merchant-scoped, monotonic comparison revision through the only
 * public cache authority. Missing/invalid values intentionally do not create a
 * shared cache key; callers must use their local, fail-open fallback instead.
 */
export async function getPublishedStorefrontComparisonRevision(
  merchantId: string
): Promise<StorefrontComparisonRevision | null> {
  const query = getPublicSupabaseClient().rpc(
    'get_published_storefront_comparison_revision',
    { p_merchant_id: merchantId }
  ) as unknown as StorefrontSingleAttemptQuery<{
    data: unknown;
    error: unknown;
  }>;
  const deadline = createStorefrontReadDeadline(
    STOREFRONT_COMPARISON_REVISION_TIMEOUT_MS
  );

  try {
    const { data, error } = await Promise.race([
      Promise.resolve(
        prepareStorefrontSingleAttemptQuery(query, deadline.signal)
      ),
      deadline.promise,
    ]);

    if (error) throw error;

    return normalizeRevision(data);
  } finally {
    deadline.cleanup();
  }
}
