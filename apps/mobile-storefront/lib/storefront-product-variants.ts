import { withSupabaseRetry } from '@/lib/api';
import { createLogger } from '@/lib/logger';
import { supabase } from '@/lib/supabase';

const log = createLogger('StorefrontProductVariants');
const STOREFRONT_VARIANT_RPC_PAGE_SIZE = 1000;

export interface StorefrontProductVariantRow {
  attributes?: Record<string, string> | null;
  condition?: string | null;
  created_at?: string | null;
  id: string;
  images?: unknown;
  price_override?: number | string | null;
  primary_image?: string | null;
  product_id: string;
  sku?: string | null;
  stock_quantity?: number | null;
  updated_at?: string | null;
  effective_policy?: string | null;
  available_units?: number | null;
}

export interface StorefrontProductBaseInventoryRow {
  product_id: string;
  effective_policy?: string | null;
  available_units?: number | null;
}

interface ProductRowWithId {
  id?: unknown;
  variants?: unknown;
}

export async function getStorefrontProductVariantsByProductIds(
  productIds: string[]
) {
  const uniqueProductIds = Array.from(
    new Set(productIds.filter((id): id is string => Boolean(id)))
  );

  if (uniqueProductIds.length === 0) {
    return {} as Record<string, StorefrontProductVariantRow[]>;
  }

  const variants: StorefrontProductVariantRow[] = [];
  let expectedVariantCount: number | null = null;
  let from = 0;

  while (
    expectedVariantCount === null ||
    variants.length < expectedVariantCount
  ) {
    const { count, data, error } = await withSupabaseRetry(
      async () =>
        await supabase
          .rpc(
            'get_storefront_product_variants',
            { p_product_ids: uniqueProductIds },
            { count: 'exact' }
          )
          .order('product_id', { ascending: true })
          .order('created_at', { ascending: true, nullsFirst: false })
          .order('id', { ascending: true })
          .range(from, from + STOREFRONT_VARIANT_RPC_PAGE_SIZE - 1),
      {
        maxRetries: 3,
        onRetry: (attempt, err) => {
          log.warn(`Variant rpc retry ${attempt}: ${err.message}`);
        },
      }
    );

    if (error) {
      log.error('Failed to fetch storefront product variants', {
        error,
        productIds: uniqueProductIds,
      });
      return null;
    }

    if (
      typeof count !== 'number' ||
      !Number.isSafeInteger(count) ||
      count < 0
    ) {
      log.error('Storefront variant rpc did not return an exact row count', {
        count,
        from,
      });
      return null;
    }

    if (expectedVariantCount === null) {
      expectedVariantCount = count;
    } else if (count !== expectedVariantCount) {
      log.warn('Storefront variant rpc changed during pagination', {
        actualCount: count,
        expectedCount: expectedVariantCount,
        from,
      });
      return null;
    }

    const page = (data ?? []) as StorefrontProductVariantRow[];
    if (page.length === 0) {
      if (variants.length === expectedVariantCount) {
        break;
      }

      log.error('Storefront variant rpc returned an incomplete page sequence', {
        expectedCount: expectedVariantCount,
        receivedCount: variants.length,
        from,
      });
      return null;
    }

    variants.push(...page);
    from += page.length;

    if (variants.length > expectedVariantCount) {
      log.error('Storefront variant rpc returned more rows than expected', {
        expectedCount: expectedVariantCount,
        receivedCount: variants.length,
      });
      return null;
    }
  }

  const variantsByProductId: Record<string, StorefrontProductVariantRow[]> = {};

  for (const variant of variants) {
    if (!variantsByProductId[variant.product_id]) {
      variantsByProductId[variant.product_id] = [];
    }

    variantsByProductId[variant.product_id].push(variant);
  }

  return variantsByProductId;
}

export async function getStorefrontProductBaseInventoryByProductIds(
  productIds: string[]
) {
  const uniqueProductIds = Array.from(
    new Set(productIds.filter((id): id is string => Boolean(id)))
  );

  if (uniqueProductIds.length === 0) {
    return {} as Record<string, StorefrontProductBaseInventoryRow>;
  }

  // One row per product at most: no pagination, but the same retry and
  // fail-soft shape as the variants fetch so callers keep their rows.
  const { data, error } = await withSupabaseRetry(
    async () =>
      await supabase.rpc('get_storefront_product_base_inventory', {
        p_product_ids: uniqueProductIds,
      }),
    {
      maxRetries: 3,
      onRetry: (attempt, err) => {
        log.warn(`Base inventory rpc retry ${attempt}: ${err.message}`);
      },
    }
  );

  if (error) {
    log.error('Failed to fetch storefront product base inventory', {
      error,
      productIds: uniqueProductIds,
    });
    return null;
  }

  const inventoryByProductId: Record<
    string,
    StorefrontProductBaseInventoryRow
  > = {};

  for (const row of (data ?? []) as StorefrontProductBaseInventoryRow[]) {
    if (typeof row?.product_id === 'string') {
      inventoryByProductId[row.product_id] = row;
    }
  }

  return inventoryByProductId;
}

export async function hydrateProductRowsWithBaseInventory<
  TRow extends ProductRowWithId,
>(rows: TRow[]) {
  const inventoryByProductId =
    await getStorefrontProductBaseInventoryByProductIds(
      rows
        .map((row) => row.id)
        .filter((id): id is string => typeof id === 'string')
    );

  if (inventoryByProductId === null) {
    return rows;
  }

  return rows.map((row) => {
    if (typeof row.id !== 'string') {
      return row;
    }

    const inventory = inventoryByProductId[row.id];
    if (!inventory) {
      return row;
    }

    return {
      ...row,
      base_effective_policy: inventory.effective_policy,
      base_available_units: inventory.available_units,
    };
  });
}

export async function hydrateProductRowsWithStorefrontVariants<
  TRow extends ProductRowWithId,
>(rows: TRow[]) {
  const variantsByProductId = await getStorefrontProductVariantsByProductIds(
    rows
      .map((row) => row.id)
      .filter((id): id is string => typeof id === 'string')
  );

  if (variantsByProductId === null) {
    return rows;
  }

  return rows.map((row) => {
    if (typeof row.id !== 'string') {
      return row;
    }

    return {
      ...row,
      variants: variantsByProductId[row.id] ?? [],
    };
  });
}
