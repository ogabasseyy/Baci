import type { Dispatch, SetStateAction } from 'react';
import type { Product, ProductVariant } from '@/types/product';
import {
  formatProductConditionDisplay,
  formatVariantAxisLabel,
} from '@/types/product';
import type { SavingsProductChoice } from './start-savings.types';

export function toProductChoice(product: Product): SavingsProductChoice {
  const storageValues = getProductStorageValues(product);

  return {
    conditionLabel: formatProductConditionDisplay(product.condition) ?? null,
    id: product.id,
    image: product.image,
    name: product.name,
    price: product.searchPreview ? 0 : product.price,
    requiresVariantSelection:
      !!product.searchPreview || hasSelectableVariants(product),
    slug: product.slug,
    variantId: null,
    variantLabel:
      storageValues.length > 0
        ? `Storage: ${formatCompactValues(storageValues)}`
        : null,
  };
}

export function applyStartSavingsProductSelection({
  product,
  previousSelectedProduct,
  setFormError,
  setSearchValue,
  setSelectedProduct,
  setTargetAmount,
  variantId,
}: {
  product: Product;
  previousSelectedProduct?: SavingsProductChoice | null;
  setFormError?: (error: string | null) => void;
  setSearchValue: (value: string) => void;
  setSelectedProduct: (choice: SavingsProductChoice | null) => void;
  setTargetAmount?: Dispatch<SetStateAction<string>>;
  variantId?: string | null;
}) {
  const choice = toSelectedProductChoice({ product, variantId });
  const nextAutoTargetAmount = choice.requiresVariantSelection
    ? ''
    : String(Math.round(choice.price));
  const previousAutoTargetAmount = previousSelectedProduct
    ? String(Math.round(previousSelectedProduct.price))
    : '';
  setFormError?.(null);
  setSelectedProduct(choice);
  setSearchValue(product.name);
  setTargetAmount?.((currentTargetAmount) => {
    const normalizedCurrentTargetAmount = currentTargetAmount.trim();
    if (
      !normalizedCurrentTargetAmount ||
      normalizedCurrentTargetAmount === previousAutoTargetAmount
    ) {
      return nextAutoTargetAmount;
    }
    return currentTargetAmount;
  });
}

export function toSelectedProductChoice({
  product,
  variantId,
}: {
  product: Product;
  variantId?: string | null;
}): SavingsProductChoice {
  const selectedVariant = variantId
    ? product.variants?.find(
        (variant) =>
          variant.id === variantId && isSavingsVariantSelectable(variant)
      )
    : null;

  if (!selectedVariant) {
    if (variantId || hasSelectableVariants(product)) {
      return {
        conditionLabel:
          formatProductConditionDisplay(product.condition) ?? null,
        id: product.id,
        image: product.image,
        name: product.name,
        price: product.price,
        requiresVariantSelection: true,
        slug: product.slug,
        variantId: null,
        variantLabel: null,
      };
    }

    return toProductChoice(product);
  }

  const variantLabel = getVariantLabel(selectedVariant.attributes);

  return {
    conditionLabel:
      formatProductConditionDisplay(selectedVariant.condition) ??
      formatProductConditionDisplay(product.condition) ??
      null,
    id: product.id,
    image:
      [
        selectedVariant.image,
        ...(selectedVariant.images ?? []),
        product.image,
        ...(product.images ?? []),
      ]
        .find((image) => typeof image === 'string' && image.trim().length > 0)
        ?.trim() ?? '',
    name: product.name,
    price: selectedVariant.price,
    requiresVariantSelection: false,
    slug: product.slug,
    variantId: selectedVariant.id,
    variantLabel,
  };
}

export function hasSelectableVariants(product: Product) {
  return (product.variants?.length ?? 0) > 0;
}

export function isSavingsVariantSelectable(variant: ProductVariant) {
  return Number.isFinite(variant.price) && variant.price > 0;
}

export function getSavingsVariantOptions(product: Product) {
  return (product.variants ?? []).map((variant) => {
    const choice = toSelectedProductChoice({
      product,
      variantId: variant.id,
    });
    return {
      conditionLabel: choice.conditionLabel ?? null,
      id: variant.id,
      label: [choice.conditionLabel, choice.variantLabel ?? variant.name]
        .filter((value): value is string => Boolean(value))
        .join(' · '),
      price: choice.price,
      unavailable: !isSavingsVariantSelectable(variant),
    };
  });
}

function formatCompactValues(values: string[]) {
  if (values.length <= 2) {
    return values.join(' / ');
  }

  return `${values.slice(0, 2).join(' / ')} +${values.length - 2} more`;
}

function getProductStorageValues(product: Product) {
  const values = new Set<string>();

  for (const value of product.variant_attributes?.storage ?? []) {
    if (value.trim()) {
      values.add(value.trim());
    }
  }

  for (const variant of product.variants ?? []) {
    const storage =
      variant.attributes?.storage?.trim() || variant.attributes?.rom?.trim();
    if (storage) {
      values.add(storage);
    }
  }

  return Array.from(values);
}

function getVariantLabel(attributes: Record<string, string> | undefined) {
  if (!attributes) {
    return null;
  }

  const parts = Object.entries(attributes)
    .filter(([key]) => key.trim().toLowerCase() !== 'hex')
    .filter(([, value]) => value)
    .map(([axis, value]) => {
      const label = formatVariantAxisLabel(axis) ?? axis;
      return `${label}: ${value}`;
    });

  return parts.length > 0 ? parts.join(' · ') : null;
}
