import type { Product } from '@/types/product';
import { formatVariantAxisLabel } from '@/types/product';
import { toSelectedProductChoice } from './start-savings-controller.utils';

/** One choosable phone: a product, or one of its exact variants. */
export type SavingsPhoneRow = {
  image: string;
  key: string;
  meta: string[];
  price: number;
  product: Product;
  title: string;
  variantId: string | null;
  variantLabel: string | null;
};

function variantMeta(product: Product, variantId?: string | null) {
  const choice = toSelectedProductChoice({ product, variantId });
  return [choice.conditionLabel, choice.variantLabel].filter(
    (value): value is string => Boolean(value)
  );
}

function variantLabel(attributes: Record<string, string> | undefined) {
  const parts = Object.entries(attributes ?? {})
    .filter(([axis, value]) => axis !== 'color' && axis !== 'colour' && value)
    .map(
      ([axis, value]) => `${formatVariantAxisLabel(axis) ?? axis}: ${value}`
    );
  return parts.length > 0 ? parts.join(' · ') : null;
}

/** Every exact choice a product offers (its variants, or the product). */
export function savingsPhoneRows(product: Product): SavingsPhoneRow[] {
  if (product.variants?.length) {
    return product.variants.map((variant) => ({
      image: variant.image ?? variant.images?.[0] ?? product.image,
      key: `${product.id}:${variant.id}`,
      meta: variantMeta(product, variant.id),
      price: variant.price,
      product,
      title: product.name,
      variantId: variant.id,
      variantLabel: variantLabel(variant.attributes),
    }));
  }
  return [
    {
      image: product.image,
      key: `${product.id}:default`,
      meta: variantMeta(product),
      price: product.price,
      product,
      title: product.name,
      variantId: null,
      variantLabel: null,
    },
  ];
}
