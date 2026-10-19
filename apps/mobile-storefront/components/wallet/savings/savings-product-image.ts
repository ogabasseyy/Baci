import type { Product } from '@/types/product';
import {
  getSavingsVariantAttributeMap,
  type SavingsVariantOptionGroup,
} from './start-savings-variant-options';

/** Preview colour immediately, even before storage and condition are selected. */
export function savingsProductImage(
  product: Product | null | undefined,
  groups: SavingsVariantOptionGroup[],
  fallback: string
): string {
  const color = groups
    .find((group) => group.key === 'color')
    ?.values.find((option) => option.selected)?.value;
  if (!product || !color) return fallback;
  const normalize = (value: string) => value.trim().toLowerCase();
  const mapped = Object.entries(product.color_images ?? {})
    .find(([key]) => normalize(key) === normalize(color))?.[1]
    .find((image) => image.trim());
  if (mapped) return mapped;
  const variant = product.variants?.find((candidate) => {
    const candidateColor = getSavingsVariantAttributeMap(candidate).color;
    return (
      candidateColor &&
      normalize(candidateColor) === normalize(color) &&
      candidate.image?.trim()
    );
  });
  return variant?.image || fallback;
}
