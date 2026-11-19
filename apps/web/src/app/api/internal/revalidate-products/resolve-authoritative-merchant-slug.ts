import { logger } from '@/lib/logger';
import type { createPublicClient } from '@/lib/supabase/public';

function normalizeMerchantSlug(value: string): string {
  return value.trim().toLowerCase();
}

export type ResolveAuthoritativeMerchantSlugResult =
  | { status: 'ok'; slug: string }
  | { status: 'skipped' }
  | { status: 'mismatch' };

/**
 * Verifies that the caller-supplied `merchantSlug` matches the authoritative
 * `merchants.slug` row for `merchantId` before any Cloudflare purge runs.
 */
export async function resolveAuthoritativeMerchantSlug(
  supabase: ReturnType<typeof createPublicClient>,
  merchantId: string,
  merchantSlug: string
): Promise<ResolveAuthoritativeMerchantSlugResult> {
  const { data: merchantRow, error: merchantLookupError } = await supabase
    .from('merchants')
    .select('slug')
    .eq('id', merchantId)
    .maybeSingle<{ slug: string | null }>();

  if (merchantLookupError) {
    logger.error({
      message:
        'Skipped Cloudflare storefront purge after merchant slug lookup failed',
      error: merchantLookupError,
      merchantId,
    });
    return { status: 'skipped' };
  }

  const resolvedSlug = merchantRow?.slug?.trim();
  if (!resolvedSlug) {
    logger.error({
      message:
        'Skipped Cloudflare storefront purge because the merchant has no slug',
      merchantId,
    });
    return { status: 'skipped' };
  }

  if (
    normalizeMerchantSlug(resolvedSlug) !== normalizeMerchantSlug(merchantSlug)
  ) {
    logger.warn({
      message:
        'Rejected internal storefront purge with a mismatched merchant slug',
      merchantId,
    });
    return { status: 'mismatch' };
  }

  return { status: 'ok', slug: resolvedSlug };
}
