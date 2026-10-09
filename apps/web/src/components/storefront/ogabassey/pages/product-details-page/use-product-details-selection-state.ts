'use client';

import type { SearchParamSource } from '@baci/shared/lib';
import { useState } from 'react';
import { projectPublicVariantSelection } from '@/lib/project-public-variant-selection';
import { resolveProductDetailsRouteSelection } from './product-details-route-selection';
import {
  getVariantConditionOptions,
  hasVariantConditionAxis,
  normalizeCanonicalProductCondition,
  resolveDefaultVariantSelection,
  resolveLowestPricedVariantSelection,
  resolveVariantDisplaySelection,
  resolveVariantSelection,
} from '@baci/shared/lib';
import type { Product } from '../../types';
import {
  applySingleOptionAxisSelectionsToVariants,
  type ConditionType,
  getEffectiveAxes,
  getSingleOptionAxisSelections,
  normalizeProductDetails,
  toRelatedProductsProduct,
} from './product-details-helpers';
import {
  areSelectionAttributesEqual,
  getSelectionColor,
  getSelectionImageIndex,
  getValidAvailableConditions,
  isValidConditionParam,
} from './product-details-selection-seed';
import { resolveVariantColorAxisKey } from './resolve-variant-color-axis-key';

type ProductDetailsSearchParams = SearchParamSource & {
  get(name: string): string | null;
};

export function useProductDetailsSelectionState(
  serverProduct: Product,
  searchParams: ProductDetailsSearchParams
) {
  const productData = normalizeProductDetails(serverProduct);
  const relatedProductsProduct = toRelatedProductsProduct(serverProduct);
  const effectiveAxes = getEffectiveAxes(serverProduct, productData);
  const singleOptionAxisSelections = getSingleOptionAxisSelections(
    productData,
    effectiveAxes
  );
  const variantResolutionVariants = projectPublicVariantSelection(
    { ...productData, price: relatedProductsProduct.price, manage_stock: productData.manage_stock !== false },
    applySingleOptionAxisSelectionsToVariants(productData.variants, singleOptionAxisSelections)
  );
  const variantResolutionProduct = {
    price: relatedProductsProduct.price,
    condition: productData.condition,
    manage_stock: productData.manage_stock,
    variants: variantResolutionVariants,
    // Route-condition validation retains an independent condition only for
    // the parent family or a matching offer; the offers must ride along or
    // valid paired-offer links lose their grade here.
    offers: productData.offers,
  };
  // PDP-only price-first default; feeds/cart keep the shared resolver.
  const defaultVariantSelection =
    resolveLowestPricedVariantSelection({ ...variantResolutionProduct }) ??
    resolveDefaultVariantSelection({ ...variantResolutionProduct });
  const usesVariantConditions = hasVariantConditionAxis({
    ...variantResolutionProduct,
  });
  const availableConditions = usesVariantConditions
    ? getValidAvailableConditions(
        getVariantConditionOptions({
          price: relatedProductsProduct.price,
          condition: productData.condition,
          variants: productData.variants,
        }),
        normalizeCanonicalProductCondition
      )
    : getValidAvailableConditions(
        [
          productData.condition,
          ...(productData.offers?.map((offer) => offer.condition) || []),
        ],
        normalizeCanonicalProductCondition
      );
  const usesVariantRouteSelection = Boolean(productData.variants?.length);
  const {
    routeCondition,
    routeOfferId,
    routeSelectionAttributes,
    routeSelectionAttributesKey,
    routeVariantId,
  } = resolveProductDetailsRouteSelection({
    offers: productData.offers,
    resolutionProduct: {
      ...variantResolutionProduct,
      attributeAxes: effectiveAxes,
      variant_attributes: serverProduct.variant_attributes,
    },
    searchParams,
    usesVariantRouteSelection,
  });
  const productColorsKey = JSON.stringify(
    productData.colors.map((color) => color.name)
  );
  const productVariantSeedKey = JSON.stringify(
    (productData.variants ?? []).map((variant) => ({
      attributes: variant.attributes ?? {},
      condition: variant.condition ?? null,
      id: variant.id ?? null,
      inventory_tracking_policy: variant.inventory_tracking_policy ?? null,
      // Reseed when price-first inputs change client-side.
      price_modifier: variant.price_modifier ?? null,
      price_override: variant.price_override ?? null,
      stock_quantity: variant.stock_quantity ?? null,
    }))
  );
  const selectionSeedKey = JSON.stringify([
    productData.condition,
    productData.id,
    productData.manage_stock ?? null,
    productColorsKey,
    productVariantSeedKey,
    relatedProductsProduct.price,
    routeCondition,
    routeSelectionAttributesKey,
    routeVariantId ?? null,
    routeOfferId,
  ]);
  // Render-time seed keeps SSR/pre-hydration selection purchasable.
  const resolveInitialSeed = () =>
    resolveVariantDisplaySelection(
      variantResolutionProduct,
      {
        attributes: routeSelectionAttributes,
        condition: routeCondition,
        variantId: routeVariantId,
      }
    ) ?? defaultVariantSelection;
  const [selectedCondition, setSelectedCondition] = useState<ConditionType>(
    () => {
      const seed = resolveInitialSeed();
      const seedCondition = normalizeCanonicalProductCondition(seed?.condition);
      return routeCondition
        ? (routeCondition as ConditionType)
        : seedCondition && isValidConditionParam(seedCondition)
          ? (seedCondition as ConditionType)
          : (normalizeCanonicalProductCondition(
              productData.condition
            ) as ConditionType) || 'new';
    }
  );
  const [selectedImage, setSelectedImage] = useState(() =>
    getSelectionImageIndex(productData, resolveInitialSeed())
  );
  const [selectedColor, setSelectedColor] = useState<number | null>(() => {
    const seedColor = getSelectionColor(resolveInitialSeed());
    const index = seedColor
      ? productData.colors.findIndex((color) => color.name === seedColor)
      : -1;
    return index >= 0 ? index : null;
  });
  const [secondaryColor, setSecondaryColor] = useState<number | null>(null);
  const [selectedAttributes, setSelectedAttributes] = useState<
    Record<string, string>
  >(() => {
    const seed = resolveInitialSeed();
    return seed
      ? {
          ...singleOptionAxisSelections,
          ...routeSelectionAttributes,
          ...seed.attributes,
        }
      : { ...singleOptionAxisSelections, ...routeSelectionAttributes };
  });
  const selectedColorName =
    selectedColor !== null
      ? productData.colors[selectedColor]?.name
      : routeSelectionAttributes.color;
  const variantColorAxisKey = selectedColorName
    ? resolveVariantColorAxisKey(variantResolutionVariants, selectedColorName)
    : null;
  const variantSelectionAttributes: Record<string, string> = {};
  for (const [axis, value] of Object.entries({
    ...routeSelectionAttributes,
    ...selectedAttributes,
  })) {
    if (
      selectedColorName &&
      (axis === 'color' || axis === 'Colour' || axis === 'colour')
    ) {
      continue;
    }
    variantSelectionAttributes[axis] = value;
  }
  if (selectedColorName) {
    variantSelectionAttributes[variantColorAxisKey ?? 'color'] =
      selectedColorName;
  }
  const currentVariantDisplaySelection = resolveVariantDisplaySelection(
    variantResolutionProduct,
    {
      condition: selectedCondition,
      attributes: variantSelectionAttributes,
    }
  );
  const currentVariantSelection = resolveVariantSelection(
    variantResolutionProduct,
    {
      condition: selectedCondition,
      attributes: variantSelectionAttributes,
    }
  );
  const currentCartVariantSelection =
    currentVariantSelection ?? currentVariantDisplaySelection;

  const routeResolvedVariantSelection = resolveInitialSeed();

  // Render-time prop/route sync avoids a one-frame stale selection.
  const [appliedSelectionSeedKey, setAppliedSelectionSeedKey] =
    useState(selectionSeedKey);
  if (selectionSeedKey !== appliedSelectionSeedKey) {
    setAppliedSelectionSeedKey(selectionSeedKey);

    const seedSelection = resolveInitialSeed();

    setSelectedCondition((previousCondition) => {
      const nextCondition = routeCondition
        ? routeCondition
        : (seedSelection?.condition as ConditionType | undefined) ||
          productData.condition ||
          'new';

      return previousCondition === nextCondition
        ? previousCondition
        : nextCondition;
    });

    const nextAttributes = seedSelection
      ? {
          ...singleOptionAxisSelections,
          ...routeSelectionAttributes,
          ...seedSelection.attributes,
        }
      : {
          ...singleOptionAxisSelections,
          ...routeSelectionAttributes,
        };

    setSelectedAttributes((previousAttributes) =>
      areSelectionAttributesEqual(previousAttributes, nextAttributes)
        ? previousAttributes
        : nextAttributes
    );
    const seedColor = getSelectionColor(seedSelection);
    const defaultColorIndex = seedColor
      ? productData.colors.findIndex((color) => color.name === seedColor)
      : -1;
    const nextImage = seedSelection
      ? getSelectionImageIndex(productData, seedSelection)
      : 0;
    const nextColor = defaultColorIndex >= 0 ? defaultColorIndex : null;
    setSelectedColor((previousColor) =>
      previousColor === nextColor ? previousColor : nextColor
    );
    setSelectedImage((previousImage) =>
      previousImage === nextImage ? previousImage : nextImage
    );
    setSecondaryColor((previousColor) =>
      previousColor === null ? previousColor : null
    );
  }

  return {
    availableConditions,
    currentCartVariantSelection,
    currentVariantDisplaySelection,
    currentVariantSelection,
    effectiveAxes,
    productData,
    relatedProductsProduct,
    secondaryColor,
    selectedAttributes,
    selectedColor,
    selectedCondition,
    selectedImage,
    setSecondaryColor,
    setSelectedAttributes,
    setSelectedColor,
    setSelectedCondition,
    routeOfferId,
    routeResolvedVariantSelection,
    setSelectedImage,
    variantSelectionAttributes,
  };
}
