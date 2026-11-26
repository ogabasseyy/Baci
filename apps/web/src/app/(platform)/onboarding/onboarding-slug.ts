import { logger } from '@/lib/logger';
import type { createClient as createServerClient } from '@/lib/supabase/server';

function buildOnboardingMerchantSlug(businessName: string): string {
  return (
    businessName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || 'store'
  );
}

type SlugResolverClient = Pick<
  Awaited<ReturnType<typeof createServerClient>>,
  'rpc'
>;

export async function resolveOnboardingMerchantSlug(
  supabase: SlugResolverClient,
  businessName: string
): Promise<string> {
  const fallbackSlug = buildOnboardingMerchantSlug(businessName);
  const { data, error } = await supabase.rpc('generate_slug', {
    text_input: businessName,
  });
  if (error) {
    logger.warn({
      message: 'Failed to generate unique merchant slug',
      businessName,
      error,
    });
    return fallbackSlug;
  }
  return typeof data === 'string' && data.trim() ? data : fallbackSlug;
}

export function hasEstablishedOnboardingSlug(
  slug: string | null | undefined
): boolean {
  return typeof slug === 'string' && slug.trim().length > 0;
}

export function isRenameSlugUnavailableError(error: {
  code?: string;
  message?: string;
}): boolean {
  const key = (error.message ?? '').trim();
  return (
    error.code === '23505' ||
    key === 'slug_taken' ||
    key === 'reserved_slug' ||
    key === 'invalid_slug'
  );
}

export function extractRenamedSlugResult(
  data: unknown,
  fallbackSlug: string,
  previousSlug: string | null | undefined
): { finalSlug: string; retiredSlug: string | null } {
  const parsed =
    data && typeof data === 'object'
      ? (data as { slug?: unknown; retired_slug?: unknown })
      : null;
  const finalSlug =
    typeof parsed?.slug === 'string' && parsed.slug.trim()
      ? parsed.slug.trim()
      : fallbackSlug;
  const retiredSlug =
    typeof parsed?.retired_slug === 'string' && parsed.retired_slug.trim()
      ? parsed.retired_slug.trim()
      : previousSlug?.trim() || null;
  return { finalSlug, retiredSlug };
}
