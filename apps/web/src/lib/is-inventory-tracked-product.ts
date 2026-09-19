type ProductInventoryPolicy = {
  id: string;
  inventory_tracking_policy?: string | null;
  manage_stock?: boolean | null;
};

type VariantInventoryPolicy = {
  inventory_tracking_policy?: string | null;
  product_id?: string | null;
};

const SERIALIZED_INVENTORY_POLICIES = new Set([
  'serialized_strict',
  'serialized_then_unlimited',
]);

/** Returns whether a product mutation can change public inventory availability. */
export function isInventoryTrackedProduct(
  product: ProductInventoryPolicy,
  variants: readonly VariantInventoryPolicy[] = []
): boolean {
  return (
    product.manage_stock === true ||
    SERIALIZED_INVENTORY_POLICIES.has(
      product.inventory_tracking_policy ?? ''
    ) ||
    variants.some(
      (variant) =>
        variant.product_id === product.id &&
        SERIALIZED_INVENTORY_POLICIES.has(
          variant.inventory_tracking_policy ?? ''
        )
    )
  );
}
