'use client';

import { resolveCriticalDefaultAndDisplaySelection } from './resolve-critical-default-and-display-selection';
import {
  resolveVariantDisplaySelection,
  resolveVariantSelection,
} from '@baci/shared/lib/product-default-variant';
import { useEffect, useState } from 'react';
import {
  canonicalizeVariantAxis,
} from '@/components/storefront/ogabassey/variant-attributes';
import { useCriticalCommerceCartActions } from './critical-commerce-cart-actions.client';
import {
  DEFAULT_CRITICAL_PRICE_CURRENCY,
  getVariantAxesWithMultipleOptions,
  normalizeCriticalVariantProduct,
  pickInitialSelectedAttributes,
} from './critical-commerce-selection';
import { buildCriticalInitialVariantIntent } from './critical-commerce-initial-intent';
import { completeCriticalSelectionChange } from './complete-critical-selection-change';
import { useCriticalRouteOfferState } from './critical-commerce-route-offer';
import {
  OgabasseyPdpCriticalCommerceContext,
  type OgabasseyPdpCriticalCommerceProviderProps,
} from './critical-commerce-state-context.client';
import { getRenderableCriticalVariantAxes } from './critical-variant-selector-options';

export {
  useOgabasseyPdpCriticalCommerce,
  useOptionalOgabasseyPdpCriticalCommerce,
} from './critical-commerce-state-context.client';

export function OgabasseyPdpCriticalCommerceProvider({
  cartProduct,
  children,
  currency = DEFAULT_CRITICAL_PRICE_CURRENCY,
  initialVariantSelection,
  initialOfferId,
  routeOfferMissing = false,
  variantAxes = [],
  variantAxisOptions = {},
  variantCount,
}: OgabasseyPdpCriticalCommerceProviderProps) {
  const selectionCartProduct = normalizeCriticalVariantProduct(
    cartProduct,
    variantAxisOptions
  );
  const variants = selectionCartProduct.variants || [];
  const firstViewportVariantAxes = getRenderableCriticalVariantAxes(
    variantAxes,
    variants,
    variantAxisOptions
  );
  const requiredVariantAxes = getVariantAxesWithMultipleOptions(variants);
  const renderableVariantAxes = firstViewportVariantAxes;
  const hiddenRequiredVariantAxes = requiredVariantAxes.filter(
    (axis) => !renderableVariantAxes.includes(axis)
  );
  const initialVariantIntent = buildCriticalInitialVariantIntent({
    attributes: initialVariantSelection?.attributes,
    condition: initialVariantSelection?.condition,
    requiredAxes: [...requiredVariantAxes, ...renderableVariantAxes],
  });
  const explicitVariantCondition = initialVariantIntent.explicitCondition;
  const { defaultVariantSelection, initialDisplayVariantSelection } =
    resolveCriticalDefaultAndDisplaySelection({
      explicitVariantCondition,
      initialResolverAttributes: initialVariantIntent.resolverAttributes,
      initialVariantSelection,
      selectionCartProduct,
      variants,
    });
  const [selectedAttributes, setSelectedAttributes] = useState<
    Record<string, string>
  >(() =>
    pickInitialSelectedAttributes({
      explicitAttributes: initialVariantIntent.selectedAttributes,
      fallbackAxisOptions: variantAxisOptions,
      renderableVariantAxes,
      selection: initialDisplayVariantSelection,
    })
  );
  const [selectedVariantId, setSelectedVariantId] = useState<
    string | undefined
  >(initialVariantSelection?.variantId);
  const [explicitSelectedAxes, setExplicitSelectedAxes] = useState<string[]>(
    () => initialVariantIntent.explicitSelectedAxes
  );
  const selectedVariantCondition = selectedAttributes.condition;
  const resolverSelectedAttributes = Object.fromEntries(
    Object.entries(selectedAttributes).filter(([axis]) => axis !== 'condition')
  );
  const purchasableVariantSelection = selectionCartProduct.has_variants
    ? resolveVariantSelection(selectionCartProduct, {
        attributes: resolverSelectedAttributes,
        condition: selectedVariantCondition,
        variantId: selectedVariantId,
      })
    : null;
  const displayVariantSelection = selectionCartProduct.has_variants
    ? (resolveVariantDisplaySelection(selectionCartProduct, {
        attributes: resolverSelectedAttributes,
        condition: selectedVariantCondition,
        variantId: selectedVariantId,
      }) ?? defaultVariantSelection)
    : null;
  const requiresVariantSelection =
    renderableVariantAxes.length > 0 || hiddenRequiredVariantAxes.length > 0;
  const effectivePurchasableVariantSelection =
    purchasableVariantSelection ??
    (requiresVariantSelection ? null : defaultVariantSelection);
  const selectedVariantSelection =
    effectivePurchasableVariantSelection ?? displayVariantSelection;
  const {
    activeRouteOffer,
    dismissRouteOffer,
    productForCart,
    routeOfferMissingActive,
  } = useCriticalRouteOfferState({
    routeOfferMissing,
    initialOfferId,
    selectionCartProduct,
    selectedVariantSelection,
    hasPurchasableVariantSelection: Boolean(
      effectivePurchasableVariantSelection
    ),
    selectedCondition: selectedVariantCondition,
  });
  const hasRequiredVariantSelection =
    renderableVariantAxes.length === 0 ||
    renderableVariantAxes.every((axis) => selectedAttributes[axis]);
  function getSelectedAxisValue(axis: string) {
    if (axis === 'condition') {
      return selectedAttributes.condition;
    }

    return selectedAttributes[axis];
  }

  const missingHiddenRequiredVariantAxes = hiddenRequiredVariantAxes.filter(
    (axis) => !(explicitSelectedAxes.includes(axis) && getSelectedAxisValue(axis))
  );
  const hasRequiredHiddenVariantSelection =
    missingHiddenRequiredVariantAxes.length === 0;
  const missingHiddenRequiredVariantAxisKey =
    missingHiddenRequiredVariantAxes.join('|');
  const hasPurchasableVariantSelection =
    !selectionCartProduct.has_variants ||
    Boolean(effectivePurchasableVariantSelection);
  const maxQuantity = productForCart.manage_stock
    ? Math.max(
        0,
        typeof productForCart.stock === 'number' ? productForCart.stock : 0
      )
    : null;
  const [quantity, setQuantity] = useState(maxQuantity === 0 ? 0 : 1);
  const [previousMaxQuantity, setPreviousMaxQuantity] = useState(maxQuantity);

  useEffect(() => {
    if (
      process.env.NODE_ENV !== 'development' ||
      !missingHiddenRequiredVariantAxisKey
    ) {
      return;
    }

    console.warn(
      '[Ogabassey PDP] Missing hidden required variant selection.',
      {
        axes: missingHiddenRequiredVariantAxisKey.split('|'),
        productId: selectionCartProduct.id,
      }
    );
  }, [missingHiddenRequiredVariantAxisKey, selectionCartProduct.id]);

  if (previousMaxQuantity !== maxQuantity) {
    setPreviousMaxQuantity(maxQuantity);
    setQuantity((current) => {
      if (maxQuantity === null) {
        return Math.max(1, current);
      }

      if (maxQuantity === 0) {
        return 0;
      }

      return Math.min(Math.max(1, current), maxQuantity);
    });
  }

  const canAddToCart =
    hasRequiredVariantSelection &&
    hasRequiredHiddenVariantSelection &&
    hasPurchasableVariantSelection &&
    !routeOfferMissingActive &&
    quantity >= 1 &&
    (maxQuantity === null || (maxQuantity > 0 && quantity <= maxQuantity));

  function handleAttributeSelection(axis: string, value: string) {
    const normalizedAxis = canonicalizeVariantAxis(axis);
    if (!normalizedAxis) {
      return;
    }
    if (normalizedAxis === 'condition') {
      dismissRouteOffer();
    }

    const nextSelection = completeCriticalSelectionChange(
      selectionCartProduct,
      { ...selectedAttributes, [normalizedAxis]: value.trim() },
      normalizedAxis,
      hiddenRequiredVariantAxes,
      renderableVariantAxes,
      variantAxisOptions
    );

    setSelectedVariantId(undefined);
    setExplicitSelectedAxes((current) => {
      const nextAxes = new Set(current);
      nextAxes.add(normalizedAxis);
      for (const hiddenAxis of hiddenRequiredVariantAxes) {
        if (nextSelection[hiddenAxis]?.trim()) {
          nextAxes.add(hiddenAxis);
        }
      }
      return [...nextAxes];
    });
    setSelectedAttributes(nextSelection);
  }

  const {
    handleAddToCart,
    handleDecrementCartQuantity,
    handleIncrementCartQuantity,
    isAtMinCartQuantity,
    quantityInCart,
  } = useCriticalCommerceCartActions({
    activeRouteOffer,
    canAddToCart,
    effectivePurchasableVariantSelection,
    maxQuantity,
    productForCart,
    quantity,
  });
  const activeQuantity = quantityInCart > 0 ? quantityInCart : quantity;
  const isAtMaxQuantity =
    maxQuantity !== null && activeQuantity >= maxQuantity;

  return (
    <OgabasseyPdpCriticalCommerceContext.Provider
      value={{
        canAddToCart,
        currency,
        explicitSelectedAxes,
        handleAddToCart,
        handleAttributeSelection,
        handleDecrementCartQuantity,
        handleIncrementCartQuantity,
        isAtMaxQuantity,
        isAtMinCartQuantity,
        maxQuantity,
        productForCart,
        quantity,
        quantityInCart,
        renderableVariantAxes,
        routeOfferMissingActive,
        selectedAttributes,
        setQuantity,
        variantAxisOptions,
        variantCount,
        variants,
      }}
    >
      {children}
    </OgabasseyPdpCriticalCommerceContext.Provider>
  );
}
