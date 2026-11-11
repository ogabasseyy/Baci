import type { SupabaseClient } from '@supabase/supabase-js';
import { productionOrigin } from '@/lib/experience/production-origins';

function safeHostname(host: string) {
  if (
    host.length > 253 ||
    host !== host.toLowerCase() ||
    !host.includes('.') ||
    host
      .split('.')
      .some(
        (part) =>
          part.length < 1 ||
          part.length > 63 ||
          !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(part)
      )
  )
    throw Error('INVALID_CANONICAL_DOMAIN');
  const origin = productionOrigin(`https://${host}`);
  if (new URL(origin).hostname !== host)
    throw Error('INVALID_CANONICAL_DOMAIN');
  return origin;
}

/** Existing scalar RPC returns only an active authoritative custom domain. */
export async function resolveVerifierCanonicalBase(
  client: SupabaseClient,
  slug: string,
  rootDomain: string
) {
  if (!/^[a-z0-9][a-z0-9-]{0,99}$/.test(slug))
    throw Error('INVALID_MERCHANT_SLUG');
  safeHostname(rootDomain);
  const result = await client.rpc('resolve_storefront_custom_domain', {
    p_slug: slug,
  });
  if (result.error) throw Error('CANONICAL_DOMAIN_UNAVAILABLE');
  if (result.data !== null && typeof result.data !== 'string')
    throw Error('CANONICAL_DOMAIN_UNAVAILABLE');
  return safeHostname(result.data ?? `${slug}.${rootDomain}`);
}

export function validateVerifierRootDomain(rootDomain: string) {
  safeHostname(rootDomain);
}
