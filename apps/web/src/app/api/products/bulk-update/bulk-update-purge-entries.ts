import {
  resolveProductPurgeCategorySegmentForRow,
  type StorefrontProductPurgeEntry,
} from '@/lib/storefront-product-purge-urls';

export const BULK_PURGE_ROW_COLUMNS =
  'id, slug, category, status, categories:category_id(slug, is_active), product_categories(category_id, categories(slug, is_active))';

export interface BulkPurgeProductRow {
  id: string;
  slug: string | null;
  category: string | null;
  status: string | null;
  categories?: unknown;
  product_categories?: unknown;
}

export function getBulkPurgeEntries(
  rows: BulkPurgeProductRow[] | null | undefined,
  previousRows: BulkPurgeProductRow[] | null | undefined = []
): StorefrontProductPurgeEntry[] {
  const entries = [...(previousRows ?? []), ...(rows ?? [])].flatMap((row) => {
    if (row.status !== 'active') return [];

    const slug = row.slug?.trim() || row.id;
    if (!slug) return [];

    return [
      {
        slug,
        categorySegment: resolveProductPurgeCategorySegmentForRow({
          slug,
          category: row.category,
          categories: row.categories,
          product_categories: row.product_categories,
        }),
      },
    ];
  });

  return Array.from(
    new Map(
      entries.map((entry) => [
        `${entry.slug}\u0000${entry.categorySegment ?? ''}`,
        entry,
      ])
    ).values()
  );
}
