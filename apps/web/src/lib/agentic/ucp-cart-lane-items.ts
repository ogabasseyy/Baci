import type { CheckoutItem } from './checkout';

type UcpLaneItem = {
  id: string;
  variant_id?: string;
  condition?: 'new' | 'used' | 'open_box' | 'refurbished';
  variant_attributes?: Record<string, string>;
};

type UcpLaneLine = { item: UcpLaneItem; quantity: number };

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
