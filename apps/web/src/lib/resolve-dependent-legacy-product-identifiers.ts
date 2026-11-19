import type { SupabaseClient } from '@supabase/supabase-js';

const DEPENDENT_LEGACY_ALIAS_LIMIT = 256;

export interface DependentLegacyProductIdentifiers {
  identifiers: string[];
  incomplete: boolean;
}

/**
 * Resolves identifiers (`id` and `slug`) for archived child products that
 * redirect to `productId` via `parent_product_id` so scoped parent mutations
 * expire cached legacy redirect targets without wiping unrelated PDPs.
 */
export async function resolveDependentLegacyProductIdentifiers(
  supabase: SupabaseClient,
  merchantId: string,
  productId: string
): Promise<DependentLegacyProductIdentifiers> {
  try {
    const { data, error } = await supabase
      .from('products')
      .select('id, slug')
      .eq('merchant_id', merchantId)
      .eq('parent_product_id', productId)
      .limit(DEPENDENT_LEGACY_ALIAS_LIMIT);

    if (error) {
      return { identifiers: [], incomplete: true };
    }

    const rows = Array.isArray(data)
      ? (data as Array<{ id?: string | null; slug?: string | null }>)
      : [];
    if (rows.length >= DEPENDENT_LEGACY_ALIAS_LIMIT) {
      return { identifiers: [], incomplete: true };
    }

    const identifiers = new Set<string>();
    for (const row of rows) {
      const id = row.id?.trim();
      const slug = row.slug?.trim();
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
