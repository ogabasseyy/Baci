import {
  buildTransactionDiscountLineKey,
  buildTransactionDiscountLineOccurrenceKey,
} from '@baci/shared/contracts';
import {
  isProductNegotiable,
  MAX_AUTO_NEGOTIATION_DISCOUNT_RATE,
} from '@baci/shared/lib';
import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import { CanonicalOrderSubtotalLoadError } from './canonical-order-subtotal';
import {
  computeEligibleLineDiscount,
  type EligibleLineDiscountResult,
  type NegotiationLineInput,
} from './eligible-line-discount';

type VariantPriceRow = {
  id: string;
  product_id: string;
  price_override: number | string | null;
};

type NegotiationCatalogRow = {
  id: string;
  name: string | null;
  brand: string | null;
  price: number | string | null;
  condition: string | null;
  vat_category_code: string | null;
  vat_rate: number | string | null;
};

type NegotiationDiscountItem = {
  condition?: string | null;
  product_id?: string;
  variant_attributes?: Record<string, string> | null;
  variant_id?: string | null;
  quantity: number;
  price: number; // client negotiated unit price (orderItemsPayload[].price)
  // Set on orderItemsPayload only after server-side quiz-voucher token
  // verification. Such lines are legitimately priced at 0 (the voucher RPC
  // applies the award amount as the order discount), so they are EXEMPT from
  // the floor / non-negotiable checks below.
  voucher_award_id?: string | null;
};

type IndexedNegotiationItem = {
  item: NegotiationDiscountItem;
  lineId: number;
};

function applyPersistedLineOccurrenceKeys(
  result: EligibleLineDiscountResult,
  indexedItems: IndexedNegotiationItem[],
  productMap: Map<string, NegotiationCatalogRow>
): EligibleLineDiscountResult {
  if (!result.lineDiscounts) {
    return result;
  }

  const lineKeys = indexedItems.map(({ item }) => {
    if (!item.product_id) {
      return null;
    }
    const product = productMap.get(item.product_id);
    return buildTransactionDiscountLineKey({
      condition: item.condition?.trim() || product?.condition,
      productId: item.product_id,
      variantAttributes: item.variant_attributes ?? null,
      variantId: item.variant_id ?? null,
    });
  });
  const lineIdentityCounts = new Map<string, number>();
  for (const { item } of indexedItems) {
    if (!item.product_id) {
      continue;
    }
    const identity = JSON.stringify([item.product_id, item.variant_id ?? null]);
    lineIdentityCounts.set(
      identity,
      (lineIdentityCounts.get(identity) ?? 0) + 1
    );
  }
  const lineKeyCounts = new Map<string, number>();
  const occurrenceByLineId = new Map<number, number>();
  for (const lineKey of lineKeys) {
    if (lineKey == null) {
      continue;
    }
    lineKeyCounts.set(lineKey, (lineKeyCounts.get(lineKey) ?? 0) + 1);
  }
  const seenLineKeys = new Map<string, number>();
  for (const [index, lineKey] of lineKeys.entries()) {
    if (lineKey == null) {
      continue;
    }
    const occurrence = (seenLineKeys.get(lineKey) ?? 0) + 1;
    seenLineKeys.set(lineKey, occurrence);
    occurrenceByLineId.set(
      indexedItems[index]?.lineId ?? index + 1,
      occurrence
    );
  }

  return {
    ...result,
    lineDiscounts: result.lineDiscounts.map((allocation) => {
      if (!allocation) {
        return allocation;
      }
      const itemIndex = allocation.lineId - 1;
      const lineKey = lineKeys[itemIndex];
      const item = indexedItems[itemIndex]?.item;
      const identity = item?.product_id
        ? JSON.stringify([item.product_id, item.variant_id ?? null])
        : null;
      if (
        lineKey == null ||
        identity == null ||
        (lineIdentityCounts.get(identity) ?? 0) < 2
      ) {
        return allocation;
      }
      const occurrence = occurrenceByLineId.get(allocation.lineId);
      if (occurrence == null) {
        return allocation;
      }
      return {
        ...allocation,
        lineKey:
          (lineKeyCounts.get(lineKey) ?? 0) === 1
            ? lineKey
            : buildTransactionDiscountLineOccurrenceKey(lineKey, occurrence),
      };
    }),
  };
}

export async function computeOrderNegotiationDiscount({
  items,
  merchantId,
  supabase,
  vatRegistered,
}: {
  items: NegotiationDiscountItem[];
  merchantId: string;
  supabase: SupabaseClient;
  // The route passes `merchant.vat_registration_status === 'registered'`.
  // Non-registered merchants charge no VAT, so the discount must not gross up.
  vatRegistered: boolean;
}): Promise<EligibleLineDiscountResult | null> {
  // Exempt verified quiz-voucher award lines entirely — they're legitimately
  // priced at 0 and dispatched to the voucher RPC. Excluding them from the id
  // lists means a pure-voucher order skips the products query and returns null
  // (so existing voucher tests need no products mock).
  const indexedItems = items.map((item, index) => ({
    item,
    lineId: index + 1,
  }));
  const validatableItems = indexedItems.filter(
    ({ item }) => !item.voucher_award_id
  );
  if (validatableItems.length === 0) {
    return null;
  }
  const productIds = Array.from(
    new Set(
      indexedItems
        .map(({ item }) => item.product_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
    )
  );
  const variantIds = Array.from(
    new Set(
      validatableItems
        .map(({ item }) => item.variant_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
    )
  );

  if (productIds.length === 0) {
    return null;
  }

  const { data: products, error: productsError } = await supabase
    .from('products')
    .select('id, name, brand, price, condition, vat_category_code, vat_rate')
    .eq('merchant_id', merchantId)
    .in('id', productIds)
    .overrideTypes<NegotiationCatalogRow[], { merge: false }>();

  if (productsError || !products) {
    logger.warn({
      message: 'Unable to load products for negotiation discount',
      error: productsError,
      merchantId,
    });
    throw new CanonicalOrderSubtotalLoadError(
      'Unable to load products for negotiation discount',
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
    throw new CanonicalOrderSubtotalLoadError(
      'Unable to load variants for negotiation discount',
      { cause: variantsError },
      variantsError.code
    );
  }

  const productMap = new Map(products.map((product) => [product.id, product]));
  const variantMap = new Map(
    (variantsData ?? []).map((variant) => [variant.id, variant])
  );

  const lines: NegotiationLineInput[] = [];
  for (const { item, lineId } of validatableItems) {
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
    lines.push({
      catalogUnitPrice: Number(variant?.price_override ?? product.price ?? 0),
      clientUnitPrice: Number(item.price),
      lineId,
      productId: item.product_id,
      quantity: Number(item.quantity),
      // The storefront RPC persists a blank/omitted line condition as the
      // catalog condition. Build the allocation key from that same snapshot
      // so duplicate product/variant lines remain matchable in history.
      condition: item.condition?.trim() || product.condition,
      variantAttributes: item.variant_attributes ?? null,
      negotiable: isProductNegotiable({
        brand: product.brand,
        name: product.name,
      }),
      vatCategoryCode: product.vat_category_code,
      // Force rate 0 for non-registered merchants so the per-line discount
      // matches the RPC (which charges 0 VAT) — otherwise a valid 2% discount
      // over-discounts by the gross-up and trips order_total_mismatch.
      vatRate: vatRegistered
        ? product.vat_rate == null
          ? null
          : Number(product.vat_rate)
        : 0,
      variantId: item.variant_id ?? null,
    });
  }

  return applyPersistedLineOccurrenceKeys(
    computeEligibleLineDiscount(lines, MAX_AUTO_NEGOTIATION_DISCOUNT_RATE),
    indexedItems,
    productMap
  );
}
