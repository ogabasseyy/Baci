import type { SupabaseClient } from '@supabase/supabase-js';
import { productionOrigin } from '@/lib/experience/production-origins';
import { VALID_SLUG_REGEX } from '@/lib/validation';

export function isCanonicalMerchantSlug(slug: string): boolean {
  return slug.length <= 63 && VALID_SLUG_REGEX.test(slug);
}

function safeHostname(host: string) {
  if (
    host.length > 253 ||
    host !== host.toLowerCase() ||
    !host.includes('.') ||
    host.split('.').some((part) => !isCanonicalMerchantSlug(part))
  )
    throw Error('INVALID_CANONICAL_DOMAIN');
  const origin = productionOrigin(`https://${host}`);
  if (new URL(origin).hostname !== host)
    throw Error('INVALID_CANONICAL_DOMAIN');
  return origin;
}

/** Existing scalar RPC returns only an active authoritative custom domain. */
export async function resolveCanonicalBase(
  client: SupabaseClient,
  slug: string,
  rootDomain: string,
  signal?: AbortSignal
) {
  if (!isCanonicalMerchantSlug(slug)) throw Error('INVALID_MERCHANT_SLUG');
  safeHostname(rootDomain);
  signal?.throwIfAborted();
  const query = client.rpc('resolve_storefront_custom_domain', {
    p_slug: slug,
  });
  const result = await (signal ? query.abortSignal(signal) : query);
  signal?.throwIfAborted();
  if (result.error) throw Error('CANONICAL_DOMAIN_UNAVAILABLE');
  if (result.data !== null && typeof result.data !== 'string')
    throw Error('CANONICAL_DOMAIN_UNAVAILABLE');
  return safeHostname(result.data ?? `${slug}.${rootDomain}`);
}

export function validateCanonicalRootDomain(rootDomain: string) {
  safeHostname(rootDomain);
}
