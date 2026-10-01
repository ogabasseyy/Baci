import { buildTransactionDiscountLineKey } from '@baci/shared/contracts';

export interface PersistedLineKeyItem {
  condition?: string | null;
  line_id?: number | string | null;
  product_id?: string | null;
  variant_attributes?: Record<string, string> | null;
  variant_id?: string | null;
}

export function getPersistedLineKey(item: PersistedLineKeyItem): string | null {
  if (
    typeof item.product_id !== 'string' ||
    item.product_id.trim().length === 0 ||
    (item.variant_id !== null && typeof item.variant_id !== 'string') ||
    (item.variant_attributes !== null &&
      item.variant_attributes !== undefined &&
      (typeof item.variant_attributes !== 'object' ||
        Array.isArray(item.variant_attributes) ||
        Object.values(item.variant_attributes).some(
          (value) => typeof value !== 'string'
        )))
  ) {
    return null;
  }

  return buildTransactionDiscountLineKey({
    condition: item.condition,
    productId: item.product_id,
    variantAttributes: item.variant_attributes,
    variantId: item.variant_id ?? null,
  });
}
