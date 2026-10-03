import { resolvePublicProductOption } from './resolve-public-product-option';

type Parent = {
  price?: number | null;
  compare_at_price?: number | null;
  condition?: string | null;
  manage_stock?: boolean | null;
  stock?: number | null;
  stock_quantity?: number | null;
};
type Variant = {
  price_override?: number | null;
  compare_at_price?: number | null;
  condition?: string | null;
  inventory_tracking_policy?: string | null;
  stock_quantity?: number | null;
};

/** Supply canonical eligibility to the generic variant-selection algorithms. */
export function projectPublicVariantSelection<TVariant extends Variant>(
  parent: Parent,
  variants: readonly TVariant[] | null | undefined
) {
  return (variants ?? []).map((variant) => ({
    ...variant,
    is_purchasable: resolvePublicProductOption(parent, { variant }).purchasable,
  }));
}
