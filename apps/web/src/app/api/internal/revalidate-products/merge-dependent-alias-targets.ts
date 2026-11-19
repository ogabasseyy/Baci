import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveDependentLegacyProductIdentifiers } from '@/lib/resolve-dependent-legacy-product-identifiers';
import type { StorefrontProductPurgeEntry } from '@/lib/storefront-product-purge-urls';
import type { InternalRevalidateProductEntry } from '@/schemas/internal-revalidate-products-route';

/**
 * Resolves archived child legacy aliases for id-backed products and merges them
 * into both Next slug invalidation and Cloudflare edge purge targets, returning
 * `incomplete: true` so callers force broad/hostname fallbacks when partial.
 */
export async function mergeDependentAliasTargets({
  supabase,
  merchantId,
  products,
  entries,
  slugs,
}: {
  supabase: SupabaseClient;
  merchantId: string;
  products: readonly InternalRevalidateProductEntry[];
  entries: readonly StorefrontProductPurgeEntry[];
  slugs: readonly string[];
}): Promise<{
  entries: StorefrontProductPurgeEntry[];
  slugs: string[];
  incomplete: boolean;
}> {
  const productIds = products
    .map((product) => product.id?.trim())
    .filter((id): id is string => Boolean(id));
  if (productIds.length === 0) {
    return { entries: [...entries], slugs: [...slugs], incomplete: false };
  }

  const dependentAliases = await resolveDependentLegacyProductIdentifiers(
    supabase,
    merchantId,
    productIds
  );
  const existingEntrySlugs = new Set(entries.map((entry) => entry.slug));
  // Parent ids are edge targets too: a cached `/products/<uuid>` response is
  // keyed by the id, so expiring its origin tag alone leaves Cloudflare stale.
  const aliasIdentifiers = Array.from(
    new Set([...productIds, ...dependentAliases.identifiers])
  );

  return {
    entries: [
      ...entries,
      ...aliasIdentifiers
        .filter((identifier) => !existingEntrySlugs.has(identifier))
        .map((identifier) => ({ slug: identifier, categorySegment: null })),
    ],
    slugs: Array.from(new Set([...slugs, ...aliasIdentifiers])),
    incomplete: dependentAliases.incomplete,
  };
}
