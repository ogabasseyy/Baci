import type { CheckoutItem } from './checkout';

type UcpLaneItem = {
  id: string;
  variant_id?: string;
  condition?: 'new' | 'used' | 'open_box' | 'refurbished';
  variant_attributes?: Record<string, string>;
};

type UcpLaneLine = { item: UcpLaneItem; quantity: number };

type CalculatedLaneLine = {
  item: {
    id?: string;
    product_id: string;
    quantity: number;
    variant_id?: string;
    condition?: string;
    variant_attributes?: Record<string, string>;
  };
};

/**
 * Persisted session items built from the calculator's resolved lane
 * identity: the parent product id plus the resolved variant, condition,
 * and options of each accepted line.
 */
export function toPersistedUcpItems(lineItems: CalculatedLaneLine[]) {
  return lineItems.map((lineItem) => ({
    id: lineItem.item.product_id,
    quantity: lineItem.item.quantity,
    ...(lineItem.item.variant_id
      ? { variant_id: lineItem.item.variant_id }
      : {}),
    ...(lineItem.item.condition ? { condition: lineItem.item.condition } : {}),
    ...(lineItem.item.variant_attributes
      ? { variant_attributes: lineItem.item.variant_attributes }
      : {}),
  }));
}

/** Calculator response lines re-identified by their resolved product. */
export function toResolvedResponseLines<T extends CalculatedLaneLine>(
  lineItems: T[]
): T[] {
  return lineItems.map((lineItem) => ({
    ...lineItem,
    item: { ...lineItem.item, id: lineItem.item.product_id },
  }));
}

/** Checkout-calculator item carrying the full UCP lane identity. */
export function toCheckoutLaneItem(line: UcpLaneLine): CheckoutItem {
  return {
    id: line.item.id,
    quantity: line.quantity,
    ...(line.item.variant_id ? { variant_id: line.item.variant_id } : {}),
    ...(line.item.condition ? { condition: line.item.condition } : {}),
    ...(line.item.variant_attributes
      ? { variant_attributes: line.item.variant_attributes }
      : {}),
  };
}

type VariantLookupClient = {
  from: (table: string) => {
    select: (columns: string) => {
      in: (
        column: string,
        values: string[]
      ) => {
        eq: (
          column: string,
          value: string
        ) => PromiseLike<{
          data: { id: string; product_id: string }[] | null;
          error: unknown;
        }>;
      };
    };
  };
};

/**
 * Rewrites canonical lines whose item id is actually a variant UUID
 * (no explicit variant lane) into the resolved product/variant pair,
 * so canonical offer checks never look the variant up as a product.
 * Lines that do not resolve stay untouched for validation to reject.
 */
export async function resolveCanonicalVariantLines<
  T extends {
    item: { productId: string; variantId?: string };
    quantity: number;
  },
>(client: VariantLookupClient, merchantId: string, lines: T[]): Promise<T[]> {
  const candidateIds = lines
    .filter((line) => !line.item.variantId)
    .map((line) => line.item.productId);
  if (!candidateIds.length) return lines;
  // Best effort: canonical validation remains the authority, so a
  // lookup failure leaves the lines untouched for it to judge.
  let data: { id: string; product_id: string }[] | null = null;
  try {
    const result = await client
      .from('product_variants')
      .select('id, product_id')
      .in('id', candidateIds)
      .eq('merchant_id', merchantId);
    if (result.error) return lines;
    data = result.data;
  } catch {
    return lines;
  }
  if (!data?.length) return lines;
  const productByVariant = new Map(data.map((row) => [row.id, row.product_id]));
  return lines.map((line) => {
    if (line.item.variantId) return line;
    const productId = productByVariant.get(line.item.productId);
    if (!productId) return line;
    return {
      ...line,
      item: { ...line.item, productId, variantId: line.item.productId },
    };
  });
}

/** Canonical replacement-plan line carrying the full UCP lane identity. */
export function toCanonicalLaneLine(item: CheckoutItem) {
  return {
    item: {
      productId: item.id,
      ...(item.variant_id ? { variantId: item.variant_id } : {}),
      ...(item.condition
        ? {
            condition: item.condition as NonNullable<UcpLaneItem['condition']>,
          }
        : {}),
      ...(item.variant_attributes ? { options: item.variant_attributes } : {}),
    },
    quantity: item.quantity,
  };
}
