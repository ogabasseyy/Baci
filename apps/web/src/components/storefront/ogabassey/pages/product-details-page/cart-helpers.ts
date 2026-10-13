import type { Product as CartProduct } from '@/lib/products';
import { normalizeCanonicalProductCondition } from '@baci/shared/lib';
import {
  canonicalizeVariantAxis,
  getVariantAttributeOptions,
} from '@/components/storefront/ogabassey/variant-attributes';
import { isDisplayOnlyVariantAxis } from '@/lib/storefront-specs/non-renderable-variant-axes';
import type { Product } from '../../types';
import type { ConditionType } from './product-condition';
import type { ProductDetailsCurrentOffer } from './offer-resolution';
import type { NormalizedProductDetails } from './product-normalization';
import { toRelatedProductsProduct } from './related-product';

export function buildCartItemId(
  productId: Product['id'],
  options?: {
    color?: string;
    secondaryColor?: string;
    condition?: string;
    storage?: string;
    variantId?: string;
    selectedAttributes?: Record<string, string>;
  }
) {
  const parts = [String(productId)];
  if (options?.variantId) {
    parts.push(`variant=${options.variantId}`);
  }
  if (options?.color) {
    parts.push(`color=${options.color}`);
  }
  if (options?.secondaryColor) {
    parts.push(`secondaryColor=${options.secondaryColor}`);
  }
  if (options?.condition) {
    parts.push(`condition=${options.condition}`);
  }

  // Include all selectedAttributes sorted by key for deterministic IDs
  if (options?.selectedAttributes) {
    for (const key of Object.keys(options.selectedAttributes).sort()) {
      // Skip keys already handled explicitly above
      if (key === 'color' || key === 'condition') continue;
      const value = options.selectedAttributes[key];
      if (value) {
        parts.push(`${key}=${value}`);
      }
    }
  } else if (options?.storage) {
    // Fallback for callers not passing selectedAttributes
    parts.push(`storage=${options.storage}`);
  }

  return parts.join('::');
}

export function getEffectiveAxes(
  serverProduct: Product,
  productData: NormalizedProductDetails
) {
  if (serverProduct.attributeAxes?.length) {
    return serverProduct.attributeAxes;
  }

  const axes: string[] = [];
  if (productData.storage.length > 0) {
    axes.push('storage');
  }
  if (productData.platforms.length > 0) {
    axes.push('platform');
  }
  return axes;
}

function getVariantBackedAxisOptions(
  axis: string,
  variants: NormalizedProductDetails['variants']
) {
  if (!variants?.length) {
    return [];
  }

  const normalizedAxis = canonicalizeVariantAxis(axis);
  const options = new Set<string>();

  if (normalizedAxis === 'condition') {
    for (const variant of variants) {
      const value = normalizeCanonicalProductCondition(variant.condition);
      if (value) {
        options.add(value);
      }
    }

    return Array.from(options);
  }

  for (const variant of variants) {
    for (const [rawAxis, value] of Object.entries(variant.attributes || {})) {
      if (canonicalizeVariantAxis(rawAxis) !== normalizedAxis) {
        continue;
      }

      const trimmedValue = typeof value === 'string' ? value.trim() : '';
      if (trimmedValue) {
        options.add(trimmedValue);
      }
    }
  }

  return Array.from(options);
}

export function hasVariantBackedAxis(
  axis: string,
  variants: NormalizedProductDetails['variants']
) {
  return getVariantBackedAxisOptions(axis, variants).length > 0;
}

export function getVariantBackedSelections(
  selectedAttributes: Record<string, string>,
  variants: NormalizedProductDetails['variants']
) {
  return Object.fromEntries(
    Object.entries(selectedAttributes).filter(([axis]) => {
      const normalizedAxis = canonicalizeVariantAxis(axis);
      return (
        hasVariantBackedAxis(normalizedAxis, variants) &&
        !isDisplayOnlyVariantAxis(normalizedAxis)
      );
    })
  );
}

function getMetadataAxisOptions(
  axis: string,
  productData: NormalizedProductDetails
) {
  if (axis === 'storage' && productData.storage.length > 0) {
    return productData.storage;
  }

  if (axis === 'platform' && productData.platforms.length > 0) {
    return productData.platforms;
  }

  return getVariantAttributeOptions(productData.variant_attributes, axis);
}

export function getAxisOptions(
  axis: string,
  productData: NormalizedProductDetails
) {
  const variantBackedOptions = getVariantBackedAxisOptions(
    axis,
    productData.variants
  );
  if (variantBackedOptions.length > 0) {
    return variantBackedOptions;
  }

  const metadataOptions = getMetadataAxisOptions(axis, productData);

  if (productData.variants?.length) {
    return metadataOptions.length === 1 ? metadataOptions : [];
  }

  return metadataOptions;
}

export function getSingleOptionAxisSelections(
  productData: NormalizedProductDetails,
  effectiveAxes: string[]
) {
  const selections: Record<string, string> = {};

  for (const axis of effectiveAxes.filter((item) => item !== 'color')) {
    const options = getAxisOptions(axis, productData);
    if (options.length === 1 && options[0]) {
      selections[axis] = options[0];
    }
  }

  return selections;
}

export function applySingleOptionAxisSelectionsToVariants(
  variants: NormalizedProductDetails['variants'],
  singleOptionAxisSelections: Record<string, string>
) {
  const selectionEntries = Object.entries(singleOptionAxisSelections);
  if (!variants?.length || selectionEntries.length === 0) {
    return variants;
  }

  return variants.map((variant) => ({
    ...variant,
    attributes: {
      ...singleOptionAxisSelections,
      ...(variant.attributes || {}),
    },
  }));
}

export function formatAxisLabel(axis: string) {
  const labels: Record<string, string> = {
    storage: 'Storage',
    ram: 'RAM',
    color: 'Color',
    platform: 'Platform',
    processor: 'Processor',
    gpu: 'GPU',
    sim_type: 'SIM Type',
  };

  return (
    labels[axis] ||
    `${axis.charAt(0).toUpperCase()}${axis.slice(1).replace(/_/g, ' ')}`
  );
}

export function getMissingSelectionFields(
  productData: NormalizedProductDetails,
  effectiveAxes: string[],
  selectedColor: number | null,
  selectedAttributes: Record<string, string>
) {
  const missing: string[] = [];

  if (selectedColor === null && productData.colors.length > 0) {
    missing.push('Color');
  }

  for (const axis of effectiveAxes.filter((item) => item !== 'color')) {
    if (
      !selectedAttributes[axis] &&
      getAxisOptions(axis, productData).length > 0
    ) {
      missing.push(formatAxisLabel(axis));
    }
  }

  return missing;
}

export function buildCartProduct(
  productData: NormalizedProductDetails,
  currentOffer: ProductDetailsCurrentOffer,
  selectedImage: number,
  selectedCondition: ConditionType,
  selectedAttributes: Record<string, string>,
  selectedColorName?: string,
  options?: { hasVariantPricing?: boolean }
): CartProduct {
  const baseProduct = toRelatedProductsProduct(productData);
  // A non-variant condition offer prices the line below catalog, but the
  // server verifies merchant-rate tiers against products.price. Retain the
  // base catalog unit price so quote subtotals use the canonical basis.
  // Variant-priced lines already match the server (price_override), so they
  // carry no override.
  const isConditionOffer =
    selectedCondition.toLowerCase() !==
    (productData.condition || 'new').toLowerCase();
  const catalogPrice =
    isConditionOffer &&
    !options?.hasVariantPricing &&
    typeof baseProduct.price === 'number' &&
    Number.isFinite(baseProduct.price) &&
    baseProduct.price >= 0
      ? baseProduct.price
      : undefined;

  // Color is carried into the cart by the image: prefer the selected color's
  // own image so the cart always depicts the chosen color, even when the
  // gallery is still showing a non-color default frame (e.g. an open-box hero
  // shot the shopper never tapped off). Falls back to the displayed frame for
  // single-image products that have no per-color image.
  const colorImage = selectedColorName
    ? productData.colorImages?.[selectedColorName]?.[0]
    : undefined;
  const image = colorImage ?? productData.images[selectedImage];

  return {
    ...baseProduct,
    ...selectedAttributes,
    price: currentOffer.rawPrice,
    ...(catalogPrice === undefined ? {} : { catalogPrice }),
    image,
    imageLarge: image,
    description: productData.description,
    rating: productData.rating,
    category: productData.categories?.name || productData.category,
    condition: selectedCondition,
  };
}
