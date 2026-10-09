import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';

type CanonicalSubtotalItem = {
  product_id?: string;
  variant_id?: string | null;
  offer_id?: string | null;
  quantity: number;
  assurance_fee: number;
};

type ProductPriceRow = {
  id: string;
  price: number | string | null;
};

type VariantPriceRow = {
  id: string;
  product_id: string;
  price_override: number | string | null;
};

export class CanonicalOrderSubtotalLoadError extends Error {
  readonly pgCode: string | undefined;

  constructor(
    message: string,
    options?: ErrorOptions,
    pgCode?: string | null | undefined
  ) {
    super(message, options);
    this.name = 'CanonicalOrderSubtotalLoadError';
    this.pgCode = typeof pgCode === 'string' ? pgCode : undefined;
  }
}

export function isCanonicalOrderSubtotalUuidError(err: unknown): boolean {
  return (
    err instanceof CanonicalOrderSubtotalLoadError && err.pgCode === '22P02'
  );
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export async function computeCanonicalOrderSubtotal({
  items,
  merchantId,
  offerPrices,
  supabase,
}: {
  items: CanonicalSubtotalItem[];
  merchantId: string;
  /** `${product_id}::${offer_id}` → live offer price, when verified. */
  offerPrices?: Map<string, number>;
  supabase: SupabaseClient;
}): Promise<number | null> {
  const productIds = Array.from(
    new Set(
      items
        .map((item) => item.product_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
    )
  );
  const variantIds = Array.from(
    new Set(
      items
        .map((item) => item.variant_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
    )
  );

  if (productIds.length === 0) {
    return null;
  }

  const { data: products, error: productsError } = await supabase
    .from('products')
    .select('id, price')
    .eq('merchant_id', merchantId)
    .in('id', productIds)
    .returns<ProductPriceRow[]>();

  if (productsError || !products) {
    logger.warn({
      message: 'Unable to load products for order subtotal parity',
      error: productsError,
      merchantId,
    });
    throw new CanonicalOrderSubtotalLoadError(
      'Unable to load products for canonical subtotal parity',
      { cause: productsError ?? undefined },
      (productsError as { code?: string } | null | undefined)?.code
    );
  }

  const { data: variantsData, error: variantsError } = variantIds.length
    ? ((await supabase.rpc('get_order_variant_overrides', {
        p_variant_ids: variantIds,
      })) as unknown as {
        data: VariantPriceRow[] | null;
        error: { message: string; code?: string } | null;
      })
    : { data: [] as VariantPriceRow[], error: null };

  if (variantsError) {
    logger.warn({
      message: 'Unable to load variants for order subtotal parity',
      error: variantsError,
      merchantId,
    });
    throw new CanonicalOrderSubtotalLoadError(
      'Unable to load variants for canonical subtotal parity',
      { cause: variantsError },
      variantsError.code
    );
  }

  const productMap = new Map(products.map((product) => [product.id, product]));
  const variantMap = new Map(
    (variantsData ?? []).map((variant) => [variant.id, variant])
  );

  let subtotal = 0;

  for (const item of items) {
    if (!item.product_id) {
      return null;
    }

    const product = productMap.get(item.product_id);
    if (!product) {
      return null;
    }

    const candidateVariant = item.variant_id
      ? variantMap.get(item.variant_id)
      : null;
    const variant =
      candidateVariant && candidateVariant.product_id === item.product_id
        ? candidateVariant
        : null;
    // Offer lines persist the live offer price (the order RPC resolves
    // variant → offer → parent), so the canonical subtotal must price from
    // the same verified basis or discount and shipping-rate eligibility
    // diverge from the persisted order. Variant and offer never coexist on
    // one line. A missing map entry is impossible after route verification
    // and throws rather than silently pricing the parent.
    const offerKey =
      !item.variant_id && item.offer_id && item.product_id
        ? `${item.product_id}::${item.offer_id}`
        : null;
    const offerPrice =
      offerKey !== null ? offerPrices?.get(offerKey) : undefined;
    if (offerKey !== null && offerPrice === undefined)
      throw new CanonicalOrderSubtotalLoadError(
        'Offer line is missing verified live offer economics'
      );
    const unitPrice = Number(
      variant?.price_override ?? offerPrice ?? product.price ?? 0
    );
    const quantity = Number(item.quantity);
    const assuranceFee = Number(item.assurance_fee ?? 0);

    if (
      !Number.isFinite(unitPrice) ||
      unitPrice < 0 ||
      !Number.isFinite(quantity) ||
      quantity <= 0 ||
      !Number.isFinite(assuranceFee) ||
      assuranceFee < 0
    ) {
      return null;
    }

    subtotal += roundMoney(unitPrice * quantity) + assuranceFee;
  }

  return roundMoney(subtotal);
}
