import type { SupabaseClient } from '@supabase/supabase-js';
import {
  loadOrderConditionPrices,
  orderConditionPrice,
} from '@/lib/checkout/order-condition-prices';
import { logger } from '@/lib/logger';

type CanonicalSubtotalItem = {
  product_id?: string;
  condition?: string | null;
  variant_id?: string | null;
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
  supabase,
}: {
  items: CanonicalSubtotalItem[];
  merchantId: string;
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

  const conditionPrices = await loadOrderConditionPrices(
    items,
    merchantId,
    supabase
  );

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
    const unitPrice = Number(
      orderConditionPrice(conditionPrices, item) ??
        variant?.price_override ??
        product.price ??
        0
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
