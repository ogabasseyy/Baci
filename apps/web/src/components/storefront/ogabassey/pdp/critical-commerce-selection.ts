import {
  canonicalizeCommerceVariantAxis,
  normalizeCanonicalProductCondition,
  normalizeCommerceVariantOption,
} from '@baci/shared/lib';
import type { Product as CartProduct, ProductVariant } from '@/lib/products';
import { canonicalizeVariantAxis } from '@/components/storefront/ogabassey/variant-attributes';
import { isDisplayOnlyVariantAxis } from '@/lib/storefront-specs/non-renderable-variant-axes';
import {
  COMPACT_OPTIONS,
  type CurrencyConfig,
  formatCurrencyWithConfig,
} from '@/lib/currency';

export interface InitialCriticalVariantSelection {
  attributes?: Record<string, string>;
  condition?: string;
  variantId?: string;
}

export interface ResolvedCriticalVariantSelection {
  attributes: Record<string, string>;
  color?: string;
  compareAtPrice?: number;
  condition?: string;
  price: number;
  storage?: string;
  variant: ProductVariant;
}

/**
 * Platform-default currency for the PDP critical commerce price display —
 * Baci's home market (NGN) — used whenever a caller doesn't have a
 * merchant-resolved currency to hand. Live PDP renders should pass the
 * merchant's resolved `CurrencyConfig` from `resolveMerchantCurrencyConfig`
 * instead of relying on this fallback.
 */
export const DEFAULT_CRITICAL_PRICE_CURRENCY: CurrencyConfig = {
  code: 'NGN',
  symbol: '₦',
  locale: 'en-NG',
};

function normalizeCriticalVariantAxis(axis: string) {
  const normalizedAxis = canonicalizeVariantAxis(axis);
  if (normalizedAxis === 'colour') {
    return 'color';
  }
  if (normalizedAxis === 'colour_hex') {
    return 'color_hex';
  }

  return normalizedAxis;
}

export function formatCriticalPrice(
  price: number,
  currency: CurrencyConfig = DEFAULT_CRITICAL_PRICE_CURRENCY
) {
  return formatCurrencyWithConfig(price, currency, COMPACT_OPTIONS);
}

function getVariantStock(
  cartProduct: CartProduct,
  selection: ResolvedCriticalVariantSelection | null
) {
  if (!selection) {
    return cartProduct.stock;
  }

  return typeof selection.variant.stock_quantity === 'number'
    ? selection.variant.stock_quantity
    : cartProduct.stock;
}

export function buildVariantCartProduct(
  cartProduct: CartProduct,
  selection: ResolvedCriticalVariantSelection | null
): CartProduct {
  if (!selection) {
    return cartProduct;
  }

  const variantImage =
    selection.variant.primary_image || selection.variant.images?.[0];

  return {
    ...cartProduct,
    compare_at_price: selection.compareAtPrice ?? cartProduct.compare_at_price,
    condition:
      (selection.condition as CartProduct['condition'] | undefined) ??
      cartProduct.condition,
    image: variantImage ?? cartProduct.image,
    imageLarge: variantImage ?? cartProduct.imageLarge,
    price: selection.price,
    stock: getVariantStock(cartProduct, selection),
  };
}

export function compactVariantOptions(
  options: Record<string, Record<string, string> | string | undefined>
) {
  return Object.fromEntries(
    Object.entries(options).filter(([, value]) => value !== undefined)
  );
}

export function normalizeCriticalVariantAttributes(
  attributes: Record<string, unknown> | null | undefined
) {
  const normalized: Record<string, string> = {};

  for (const [rawAxis, value] of Object.entries(attributes || {})) {
    const normalizedAxis = normalizeCriticalVariantAxis(rawAxis);
    const axis =
      normalizedAxis === 'color_hex'
        ? 'color_hex'
        : canonicalizeCommerceVariantAxis(normalizedAxis);
    const trimmedValue = typeof value === 'string' ? value.trim() : '';

    if (!axis || !trimmedValue) {
      continue;
    }

    const normalizedValue =
      axis === 'color_hex'
        ? trimmedValue
        : axis === 'condition'
          ? normalizeCanonicalProductCondition(trimmedValue)
          : normalizeCommerceVariantOption(axis, trimmedValue);
    if (normalizedValue) {
      normalized[axis] = normalizedValue;
    }
  }

  return normalized;
}

function getSingleOptionVariantAttributes(
  variantAxisOptions: Record<string, string[]> | null | undefined
) {
  const attributes: Record<string, string> = {};

  for (const [rawAxis, options] of Object.entries(variantAxisOptions || {})) {
    const axis = canonicalizeCommerceVariantAxis(rawAxis);
    const option = options.length === 1 ? options[0]?.trim() : '';

    if (!axis || axis === 'condition' || !option) {
      continue;
    }

    const normalizedOption = normalizeCommerceVariantOption(axis, option);
    if (normalizedOption) {
      attributes[axis] = normalizedOption;
    }
  }

  return attributes;
}

export function normalizeCriticalVariantProduct(
  cartProduct: CartProduct,
  variantAxisOptions?: Record<string, string[]>
): CartProduct {
  if (!cartProduct.variants || cartProduct.variants.length === 0) {
    return cartProduct;
  }

  const singleOptionVariantAttributes =
    getSingleOptionVariantAttributes(variantAxisOptions);

  return {
    ...cartProduct,
    variants: cartProduct.variants.map((variant) => ({
      ...variant,
      attributes: {
        ...singleOptionVariantAttributes,
        ...normalizeCriticalVariantAttributes(variant.attributes),
      },
      condition: variant.condition ?? cartProduct.condition,
    })),
  };
}

export function getVariantAxesWithMultipleOptions(variants: ProductVariant[]) {
  const axisValues: Record<string, Set<string>> = {};

  const addAxisValue = (rawAxis: string, value: unknown) => {
    const normalizedAxis = normalizeCriticalVariantAxis(rawAxis);
    const axis =
      normalizedAxis === 'condition'
        ? 'condition'
        : canonicalizeCommerceVariantAxis(normalizedAxis);
    const trimmedValue = typeof value === 'string' ? value.trim() : '';

    if (!axis || !trimmedValue) {
      return;
    }

    const normalizedValue =
      axis === 'condition'
        ? normalizeCanonicalProductCondition(trimmedValue)
        : normalizeCommerceVariantOption(axis, trimmedValue);
    if (!normalizedValue) {
      return;
    }

    if (!axisValues[axis]) {
      axisValues[axis] = new Set<string>();
    }

    axisValues[axis].add(normalizedValue);
  };

  for (const variant of variants) {
    addAxisValue('condition', variant.condition);

    for (const [rawAxis, value] of Object.entries(variant.attributes || {})) {
      const axis = canonicalizeVariantAxis(rawAxis);
      if (axis === 'condition') {
        continue;
      }

      addAxisValue(axis, value);
    }
  }

  return Object.entries(axisValues)
    .filter(([axis, values]) => values.size > 1 && !isDisplayOnlyVariantAxis(axis))
    .map(([axis]) => axis);
}

export function pickInitialSelectedAttributes({
  explicitAttributes,
  fallbackAxisOptions,
  renderableVariantAxes,
  selection,
}: {
  explicitAttributes?: Record<string, string>;
  fallbackAxisOptions?: Record<string, string[]>;
  renderableVariantAxes: string[];
  selection: ResolvedCriticalVariantSelection | null;
}) {
  const normalizedExplicitAttributes =
    normalizeCriticalVariantAttributes(explicitAttributes);
  const normalizedSelectionAttributes = selection
    ? normalizeCriticalVariantAttributes(selection.attributes)
    : getSingleOptionVariantAttributes(fallbackAxisOptions);
  const normalizedSelectionCondition = selection?.condition?.trim();
  if (selection && normalizedSelectionCondition) {
    normalizedSelectionAttributes.condition = normalizedSelectionCondition;
  }
  const selectableAxes = new Set([
    ...renderableVariantAxes.map(normalizeCriticalVariantAxis).filter(Boolean),
    ...Object.keys(normalizedExplicitAttributes),
  ]);
  const initialAttributes = selection
    ? normalizedSelectionAttributes
    : {
        ...normalizedSelectionAttributes,
        ...normalizedExplicitAttributes,
      };

  return Object.fromEntries(
    Object.entries(initialAttributes).filter(([axis]) =>
      selectableAxes.has(axis)
    )
  );
}
