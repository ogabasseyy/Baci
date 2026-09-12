import type {
  RedvaultAuthoritativeLine,
  RedvaultItemAllocation,
} from '@baci/shared/contracts';
import { calculateRedvaultPricing } from '@baci/shared/lib';
import type { SupabaseClient } from '@supabase/supabase-js';
import { CanonicalOrderSubtotalLoadError } from './canonical-order-subtotal';

type CheckoutItem = {
  condition?: string | null;
  price?: number;
  product_id?: string;
  quantity: number;
  variant_attributes?: Record<string, string> | null;
  variant_id?: string | null;
};

type CatalogProduct = {
  brand: string | null;
  condition: string | null;
  id: string;
  name: string | null;
  price: number | string | null;
  vat_category_code: string | null;
  vat_rate: number | string | null;
};

type VariantPrice = {
  id: string;
  price_override: number | string | null;
  product_id: string;
};

export type RedvaultOrderQuote = {
  discountKobo: number;
  eligibleSubtotalKobo: number;
  groups: Array<{
    condition: string | null;
    discountKobo: number;
    key: string;
    lineSubtotalKobo: number;
    members: Array<{
      allocationKobo: number;
      lineId: number;
      quantity: number;
    }>;
    productId: string;
    taxInclusive: false;
    unitPriceKobo: number;
    variantAttributes: Record<string, string>;
    variantId: string | null;
    vatCategoryCode: string;
    vatRateBp: number;
  }>;
  lines: Array<{
    brand: string | null;
    name: string | null;
    unitPriceKobo: number;
    variantAttributes: Record<string, string> | null;
    variantId: string | null;
    vatCategoryCode: string;
    vatRateBp: number;
    condition: string | null;
    discountKobo: number;
    lineId: number;
    productId: string;
    quantity: number;
    unitDiscountsKobo: number[];
  }>;
  productSubtotalKobo: number;
};

function asKobo(value: number | string | null): number {
  if (value === null || (typeof value === 'string' && !value.trim())) {
    throw new CanonicalOrderSubtotalLoadError('Catalog price is missing');
  }
  const amount = Number(value);
  const kobo = Math.round(amount * 100);
  if (
    !Number.isFinite(amount) ||
    amount < 0 ||
    Math.abs(amount * 100 - kobo) > 1e-6
  ) {
    throw new CanonicalOrderSubtotalLoadError(
      'Catalog price is not representable in kobo'
    );
  }
  return kobo;
}

function stableAttributes(value: Record<string, string> | null): string {
  return JSON.stringify(
    Object.entries(value ?? {}).sort(([left], [right]) =>
      left.localeCompare(right)
    )
  );
}

export async function computeRedvaultOrderQuote({
  items,
  merchantId,
  supabase,
}: {
  items: CheckoutItem[];
  merchantId: string;
  supabase: SupabaseClient;
}): Promise<RedvaultOrderQuote> {
  const productIds = [
    ...new Set(
      items
        .map((item) => item.product_id)
        .filter((id): id is string => Boolean(id))
    ),
  ];
  if (productIds.length === 0) {
    throw new CanonicalOrderSubtotalLoadError(
      'REDVAULT requires catalog products'
    );
  }
  const { data: products, error: productsError } = await supabase
    .from('products')
    .select('id, name, brand, price, condition, vat_category_code, vat_rate')
    .eq('merchant_id', merchantId)
    .in('id', productIds)
    .overrideTypes<CatalogProduct[], { merge: false }>();
  if (productsError || !products) {
    throw new CanonicalOrderSubtotalLoadError(
      'Unable to load catalog products for REDVAULT',
      { cause: productsError ?? undefined }
    );
  }
  const variantIds = [
    ...new Set(
      items
        .map((item) => item.variant_id)
        .filter((id): id is string => Boolean(id))
    ),
  ];
  const { data: variants, error: variantsError } = variantIds.length
    ? ((await supabase.rpc('get_order_variant_overrides', {
        p_variant_ids: variantIds,
      })) as unknown as {
        data: VariantPrice[] | null;
        error: { code?: string; message: string } | null;
      })
    : { data: [] as VariantPrice[], error: null };
  if (variantsError) {
    throw new CanonicalOrderSubtotalLoadError(
      'Unable to load catalog variants for REDVAULT',
      { cause: variantsError },
      variantsError.code
    );
  }
  const productsById = new Map(
    products.map((product) => [product.id, product])
  );
  const variantsById = new Map(
    (variants ?? []).map((variant) => [variant.id, variant])
  );
  const authoritativeLines: RedvaultAuthoritativeLine[] = items.map(
    (item, index) => {
      const product = item.product_id
        ? productsById.get(item.product_id)
        : null;
      if (!product)
        throw new CanonicalOrderSubtotalLoadError(
          'Requested product is not in the merchant catalog'
        );
      const variant = item.variant_id
        ? variantsById.get(item.variant_id)
        : null;
      if (item.variant_id && (!variant || variant.product_id !== product.id))
        throw new CanonicalOrderSubtotalLoadError(
          'Variant does not belong to requested product'
        );
      return {
        brand: product.brand,
        condition: item.condition?.trim() || product.condition,
        itemId: `line-${index + 1}`,
        name: product.name,
        persistedItemOrder: index + 1,
        productId: product.id,
        quantity: item.quantity,
        taxBasis: 'exclusive',
        unitPriceKobo: asKobo(variant?.price_override ?? product.price),
        variantAttributes: item.variant_attributes ?? {},
        variantId: item.variant_id ?? null,
        vatCategoryCode: product.vat_category_code ?? 'S',
        vatRateBasisPoints: asKobo(product.vat_rate ?? 7.5),
      };
    }
  );
  const pricing = calculateRedvaultPricing(authoritativeLines);
  const allocationById = new Map(
    pricing.allocations.map((allocation) => [allocation.itemId, allocation])
  );
  const lines = authoritativeLines.map((line) => {
    const allocation = allocationById.get(line.itemId);
    if (!allocation) throw new Error('Missing REDVAULT allocation');
    return {
      brand: line.brand,
      name: line.name,
      vatCategoryCode: line.vatCategoryCode,
      vatRateBp: line.vatRateBasisPoints,
      condition: line.condition,
      discountKobo: allocation.discountKobo,
      lineId: line.persistedItemOrder,
      productId: line.productId,
      quantity: line.quantity,
      unitDiscountsKobo: allocation.unitDiscountsKobo,
      unitPriceKobo: line.unitPriceKobo,
      variantAttributes: line.variantAttributes,
      variantId: line.variantId,
    };
  });
  const groups = new Map<string, RedvaultOrderQuote['groups'][number]>();
  for (const line of authoritativeLines) {
    const allocation = allocationById.get(
      line.itemId
    ) as RedvaultItemAllocation;
    if (!allocation.eligible) continue;
    const key = JSON.stringify([
      line.productId,
      line.variantId,
      line.condition,
      stableAttributes(line.variantAttributes),
      line.unitPriceKobo,
      line.vatCategoryCode.toUpperCase(),
      line.vatRateBasisPoints,
      line.taxBasis,
    ]);
    const group = groups.get(key) ?? {
      condition: line.condition,
      discountKobo: 0,
      key,
      lineSubtotalKobo: 0,
      members: [],
      productId: line.productId,
      taxInclusive: false as const,
      unitPriceKobo: line.unitPriceKobo,
      variantAttributes: line.variantAttributes ?? {},
      variantId: line.variantId,
      vatCategoryCode: line.vatCategoryCode,
      vatRateBp: line.vatRateBasisPoints,
    };
    group.members.push({
      allocationKobo: allocation.discountKobo,
      lineId: line.persistedItemOrder,
      quantity: line.quantity,
    });
    group.discountKobo += allocation.discountKobo;
    group.lineSubtotalKobo += line.unitPriceKobo * line.quantity;
    groups.set(key, group);
  }
  return {
    discountKobo: pricing.discountKobo,
    eligibleSubtotalKobo: pricing.eligibleSubtotalKobo,
    groups: [...groups.values()],
    lines,
    productSubtotalKobo: pricing.productSubtotalKobo,
  };
}
