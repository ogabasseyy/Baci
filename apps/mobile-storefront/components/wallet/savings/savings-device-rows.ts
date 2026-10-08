import type { Product, ProductVariant } from '@/types/product';
import { toSelectedProductChoice } from './start-savings-controller.utils';

export type SavingsDeviceRow = {
  image: string;
  key: string;
  meta: string[];
  price: number;
  product: Product;
  title: string;
  variantId: string | null;
  variantLabel: string | null;
};

function isEligibleSavingsVariant(variant: ProductVariant) {
  return Number.isFinite(variant.price) && variant.price > 0;
}

export function getSavingsDeviceRows(product: Product): SavingsDeviceRow[] {
  const eligibleVariants = (product.variants ?? []).filter(
    isEligibleSavingsVariant
  );

  if ((product.variants?.length ?? 0) > 0) {
    return eligibleVariants.map((variant) => {
      const choice = toSelectedProductChoice({
        product,
        variantId: variant.id,
      });
      return {
        image: choice.image,
        key: `${product.id}:${variant.id}`,
        meta: [choice.conditionLabel, choice.variantLabel].filter(
          (value): value is string => Boolean(value)
        ),
        price: choice.price,
        product,
        title: product.name,
        variantId: variant.id,
        variantLabel: choice.variantLabel ?? null,
      };
    });
  }

  const choice = toSelectedProductChoice({ product, variantId: null });
  return [
    {
      image: choice.image,
      key: `${product.id}:default`,
      meta: [choice.conditionLabel, choice.variantLabel].filter(
        (value): value is string => Boolean(value)
      ),
      price: choice.price,
      product,
      title: product.name,
      variantId: null,
      variantLabel: null,
    },
  ];
}
