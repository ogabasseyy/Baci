import { NextResponse } from 'next/server';

type CatalogQueryResult = {
  error: unknown;
};

type BaseInventoryRow = {
  product_id: string;
  available_units: number | string | null;
};

type BaseInventoryClient = {
  rpc: (
    fn: string,
    args: Record<string, unknown>
  ) => PromiseLike<{ data: unknown; error: unknown }>;
};

/**
 * Maps catalog-load failures to the shared 500 response, or the
 * narrowed offer map when every load succeeded. Split out of the
 * route (module size guard).
 */
export function resolveCartValidationCatalog<TOfferMap>({
  productsResult,
  variantsResult,
  offerMap,
}: {
  productsResult: CatalogQueryResult;
  variantsResult: CatalogQueryResult;
  offerMap: TOfferMap | Error;
}):
  | { catalogError: NextResponse; offerMap: null }
  | { catalogError: null; offerMap: TOfferMap } {
  const failure = (message: string, cause: unknown) => {
    console.error(message, cause);
    return {
      catalogError: NextResponse.json(
        { error: 'Failed to validate cart.' },
        { status: 500 }
      ),
      offerMap: null,
    } as const;
  };
  if (productsResult.error) {
    return failure('Cart validation query error:', productsResult.error);
  }
  if (variantsResult.error) {
    return failure(
      'Cart validation variant query error:',
      variantsResult.error
    );
  }
  if (offerMap instanceof Error) {
    return failure('Cart validation offer query error:', offerMap);
  }
  return { catalogError: null, offerMap };
}

/**
 * Indexes the loaded catalog rows for per-line lookups (split out of
 * the route: module size guard).
 */
export function buildCartValidationCatalog<
  TProduct extends { id: string | number },
  TVariant extends { id: string | number; product_id: string | number },
>(products: readonly TProduct[], variants: readonly TVariant[]) {
  return {
    productMap: new Map(
      products.map((product) => [String(product.id), product] as const)
    ),
    variantMap: new Map(
      variants.map((variant) => [String(variant.id), variant] as const)
    ),
    productsWithLiveVariants: new Set(
      variants.map((variant) => String(variant.product_id))
    ),
  };
}

/**
 * Live shared-unit pools for the strict serialized products in the
 * cart, in one batched base-inventory projection call. Products that
 * are not strict-tracked, carry no simple lines, or miss the
 * projection (unpublished for this caller) resolve to no entry and
 * skip the pool check; an RPC failure fails open the same way —
 * validation must never nuke carts on an infra blip.
 */
export async function fetchStrictPoolUnits({
  supabase,
  products,
  simpleProductTotals,
}: {
  supabase: BaseInventoryClient;
  products: readonly {
    id: string | number;
    inventory_tracking_policy?: string | null;
  }[];
  simpleProductTotals: ReadonlyMap<string, number>;
}): Promise<Map<string, number>> {
  const strictIds = products
    .filter(
      (product) =>
        product.inventory_tracking_policy === 'serialized_strict' &&
        simpleProductTotals.has(String(product.id))
    )
    .map((product) => String(product.id));
  if (strictIds.length === 0) {
    return new Map();
  }

  try {
    const { data, error } = await supabase.rpc(
      'get_storefront_product_base_inventory',
      { p_product_ids: strictIds }
    );
    if (error || !Array.isArray(data)) {
      console.error(
        'Cart validation base-inventory query error:',
        error ?? 'unexpected response shape'
      );
      return new Map();
    }
    const pools = new Map<string, number>();
    for (const row of data as BaseInventoryRow[]) {
      const units =
        typeof row?.available_units === 'number'
          ? row.available_units
          : typeof row?.available_units === 'string' &&
              row.available_units.trim() !== ''
            ? Number(row.available_units)
            : Number.NaN;
      if (
        typeof row?.product_id === 'string' &&
        Number.isFinite(units) &&
        units >= 0
      ) {
        pools.set(row.product_id, units);
      }
    }
    return pools;
  } catch (rpcError) {
    console.error('Cart validation base-inventory query threw:', rpcError);
    return new Map();
  }
}
