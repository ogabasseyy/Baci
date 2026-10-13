'use client';

import {
  normalizeCanonicalProductCondition,
  resolveDefaultVariantSelection,
  resolveLowestPricedVariantSelection,
  resolveVariantDisplaySelection,
  resolveVariantSelection,
} from '@baci/shared/lib';
import { useEffect, useState } from 'react';
import {
  canonicalizeVariantAxis,
} from '@/components/storefront/ogabassey/variant-attributes';
import { pruneSelectionsByVariantAvailability } from '@/components/storefront/ogabassey/variant-selection-pruning';
import { recoverHiddenSelectionsFromUniqueVariant } from '@/components/storefront/ogabassey/recover-hidden-variant-selections';
import { useCart } from '@/hooks/cart';
import {
  buildVariantCartProduct,
  compactVariantOptions,
  DEFAULT_CRITICAL_PRICE_CURRENCY,
  getVariantAxesWithMultipleOptions,
  normalizeCriticalVariantProduct,
  pickInitialSelectedAttributes,
} from './critical-commerce-selection';
import { buildCriticalInitialVariantIntent } from './critical-commerce-initial-intent';
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
  // PDP opens on the cheapest buyable variant unless the route supplied an
  // explicit condition. Preserve URL intent first, then fall back to the
  // PDP-only price-first default; feeds/cart keep the shared condition-first
  // resolver.
  const conditionDefaultVariantSelection =
    selectionCartProduct.has_variants && explicitVariantCondition
      ? resolveDefaultVariantSelection(selectionCartProduct, {
          condition: explicitVariantCondition,
        })
      : null;
  const priceDefaultVariantSelection = selectionCartProduct.has_variants
    ? resolveLowestPricedVariantSelection(selectionCartProduct)
    : null;
  const defaultVariantSelection = selectionCartProduct.has_variants
    ? (conditionDefaultVariantSelection ??
      priceDefaultVariantSelection ??
      resolveDefaultVariantSelection(selectionCartProduct, {
        condition: explicitVariantCondition,
      }))
    : null;
  const initialDisplayVariantSelection = selectionCartProduct.has_variants
    ? (resolveVariantDisplaySelection(selectionCartProduct, {
        attributes: initialVariantIntent.resolverAttributes,
        condition: explicitVariantCondition,
        variantId: initialVariantSelection?.variantId,
      }) ?? defaultVariantSelection)
    : null;
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
  const productForCart = buildVariantCartProduct(
    selectionCartProduct,
    selectedVariantSelection
  );
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
  const { addToCart, setIsCartOpen } = useCart();

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

  const isAtMaxQuantity = maxQuantity !== null && quantity >= maxQuantity;
  const canAddToCart =
    hasRequiredVariantSelection &&
    hasRequiredHiddenVariantSelection &&
    hasPurchasableVariantSelection &&
    quantity >= 1 &&
    (maxQuantity === null || (maxQuantity > 0 && quantity <= maxQuantity));

  function handleAttributeSelection(axis: string, value: string) {
    const normalizedAxis = canonicalizeVariantAxis(axis);
    if (!normalizedAxis) {
      return;
    }

    const nextSelection = recoverHiddenSelectionsFromUniqueVariant(
      pruneSelectionsByVariantAvailability(
        {
          ...selectedAttributes,
          [normalizedAxis]: value.trim(),
        },
        normalizedAxis,
        variants
      ),
      hiddenRequiredVariantAxes,
      variants
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

  function handleAddToCart() {
    if (!canAddToCart) {
      return;
    }

    const variantOptions = effectivePurchasableVariantSelection
      ? compactVariantOptions({
          color:
            effectivePurchasableVariantSelection.color ??
            effectivePurchasableVariantSelection.attributes.color,
          condition:
            effectivePurchasableVariantSelection.condition ??
            productForCart.condition,
          storage:
            effectivePurchasableVariantSelection.storage ??
            effectivePurchasableVariantSelection.attributes.storage,
          variantAttributes: effectivePurchasableVariantSelection.attributes,
          variantId: effectivePurchasableVariantSelection.variant.id,
        })
      : productForCart.condition
        ? { condition: productForCart.condition }
        : undefined;

    addToCart(productForCart, quantity, variantOptions);
    setIsCartOpen(true);
  }

  return (
    <OgabasseyPdpCriticalCommerceContext.Provider
      value={{
        canAddToCart,
        currency,
        explicitSelectedAxes,
        handleAddToCart,
        handleAttributeSelection,
        isAtMaxQuantity,
        maxQuantity,
        productForCart,
        quantity,
        renderableVariantAxes,
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
