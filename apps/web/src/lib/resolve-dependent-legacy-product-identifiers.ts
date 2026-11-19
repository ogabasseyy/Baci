import type { SupabaseClient } from '@supabase/supabase-js';

const DEPENDENT_LEGACY_ALIAS_LIMIT = 256;

export interface DependentLegacyProductIdentifiers {
  identifiers: string[];
  incomplete: boolean;
}

/**
 * Resolves identifiers (`id` and `slug`) for archived child products that
 * redirect to `productIdOrIds` via `parent_product_id` so scoped parent
 * mutations expire cached legacy redirect targets without wiping unrelated PDPs.
 */
export async function resolveDependentLegacyProductIdentifiers(
  supabase: SupabaseClient,
  merchantId: string,
  productIdOrIds: string | readonly string[]
): Promise<DependentLegacyProductIdentifiers> {
  const parentIds = Array.from(
    new Set(
      (typeof productIdOrIds === 'string' ? [productIdOrIds] : productIdOrIds)
        .map((id) => id.trim())
        .filter(Boolean)
    )
  );
  if (parentIds.length === 0) {
    return { identifiers: [], incomplete: false };
  }
  if (parentIds.length > DEPENDENT_LEGACY_ALIAS_LIMIT) {
    return { identifiers: [], incomplete: true };
  }

  try {
    const baseQuery = supabase
      .from('products')
      .select('id, slug')
      .eq('merchant_id', merchantId);
    const filteredQuery =
      parentIds.length === 1
        ? baseQuery.eq('parent_product_id', parentIds[0])
        : baseQuery.in('parent_product_id', parentIds);
    const { data, error } = await filteredQuery.limit(
      DEPENDENT_LEGACY_ALIAS_LIMIT
    );

    if (error) {
      return { identifiers: [], incomplete: true };
    }

    if (!Array.isArray(data)) {
      return { identifiers: [], incomplete: true };
    }
    if (data.length >= DEPENDENT_LEGACY_ALIAS_LIMIT) {
      return { identifiers: [], incomplete: true };
    }

    const identifiers = new Set<string>();
    for (const row of data) {
      if (typeof row !== 'object' || row === null) {
        return { identifiers: [], incomplete: true };
      }
      const rawId = 'id' in row ? row.id : undefined;
      const rawSlug = 'slug' in row ? row.slug : undefined;
      if (
        (rawId !== undefined && rawId !== null && typeof rawId !== 'string') ||
        (rawSlug !== undefined &&
          rawSlug !== null &&
          typeof rawSlug !== 'string')
      ) {
        return { identifiers: [], incomplete: true };
      }
      const id = rawId?.trim();
      const slug = rawSlug?.trim();
      if (id) identifiers.add(id);
      if (slug) identifiers.add(slug);
    }

    return {
      identifiers: Array.from(identifiers),
      incomplete: false,
    };
  } catch {
    return { identifiers: [], incomplete: true };
  }
}
