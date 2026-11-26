'use client';

import { resolveCriticalDefaultAndDisplaySelection } from './resolve-critical-default-and-display-selection';
import { SHARED_CART_MAX_QUANTITY_PER_LINE } from '@baci/shared/cart';
import {
  resolveVariantDisplaySelection,
  resolveVariantSelection,
} from '@baci/shared/lib/product-default-variant';
import {
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { canonicalizeVariantAxis } from '@/components/storefront/ogabassey/variant-attributes';
import { useCart } from '@/hooks/cart';
import { useCriticalAddToCartBlocker } from './critical-add-to-cart-blocker.client';
import { resolveMissingCriticalVariantAxes } from './critical-missing-variant-axes';
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
  type OgabasseyPdpCriticalQuerySelectionSync,
  OgabasseyPdpCriticalQuerySyncContext,
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
  const [queryRouteOfferOverride, setQueryRouteOfferOverride] = useState<{
    initialOfferId?: string | null;
    routeOfferMissing?: boolean;
  } | null>(null);
  const hasUserInteractedRef = useRef(false);
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
  const effectiveOfferId =
    queryRouteOfferOverride?.initialOfferId !== undefined
      ? queryRouteOfferOverride.initialOfferId
      : initialOfferId;
  const effectiveRouteOfferMissing =
    queryRouteOfferOverride?.routeOfferMissing ?? routeOfferMissing;
  const {
    activeRouteOffer,
    dismissRouteOffer,
    productForCart,
    routeOfferMissingActive,
  } = useCriticalRouteOfferState({
    routeOfferMissing: effectiveRouteOfferMissing,
    initialOfferId: effectiveOfferId,
    selectionCartProduct,
    selectedVariantSelection,
    hasPurchasableVariantSelection: Boolean(
      effectivePurchasableVariantSelection
    ),
    selectedCondition: selectedVariantCondition,
  });
  const { missingHiddenRequiredVariantAxes, missingRenderableVariantAxes } =
    resolveMissingCriticalVariantAxes({
      explicitSelectedAxes,
      hiddenRequiredVariantAxes,
      renderableVariantAxes,
      resolvedVariant: purchasableVariantSelection?.variant,
      selectedAttributes,
      variants,
    });
  const hasRequiredVariantSelection = missingRenderableVariantAxes.length === 0;
  const hasRequiredHiddenVariantSelection =
    missingHiddenRequiredVariantAxes.length === 0;
  const missingHiddenRequiredVariantAxisKey =
    missingHiddenRequiredVariantAxes.join('|');
  const hasPurchasableVariantSelection =
    !selectionCartProduct.has_variants ||
    Boolean(effectivePurchasableVariantSelection);
  const hasExactVariantSelection =
    hasRequiredVariantSelection &&
    hasRequiredHiddenVariantSelection &&
    hasPurchasableVariantSelection;
  const { sharedCartEnabled = false } = useCart();
  const stockLimit = productForCart.manage_stock
    ? Math.max(
        0,
        typeof productForCart.stock === 'number' ? productForCart.stock : 0
      )
    : null;
  const maxQuantity = sharedCartEnabled
    ? stockLimit === null
      ? SHARED_CART_MAX_QUANTITY_PER_LINE
      : Math.min(stockLimit, SHARED_CART_MAX_QUANTITY_PER_LINE)
    : stockLimit;
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

  const {
    handleAddToCart: submitAddToCart,
    handleDecrementCartQuantity,
    handleIncrementCartQuantity,
    isAtMinCartQuantity,
    quantityInCart,
  } = useCriticalCommerceCartActions({
    activeRouteOffer,
    canAddToCart,
    effectivePurchasableVariantSelection,
    hasExactVariantSelection,
    maxQuantity,
    productForCart,
    quantity,
  });
  const activeQuantity = quantityInCart > 0 ? quantityInCart : quantity;
  const isAtMaxQuantity =
    maxQuantity !== null && activeQuantity >= maxQuantity;
  const { clearAddToCartBlockedAttempt, ...addToCartControls } =
    useCriticalAddToCartBlocker({
    canAddToCart,
    maxQuantity,
    missingAxes: missingRenderableVariantAxes,
    missingHiddenAxes: missingHiddenRequiredVariantAxes,
    routeOfferMissingActive,
    submitAddToCart,
    visibleAxes: renderableVariantAxes,
  });

  function handleAttributeSelection(axis: string, value: string) {
    const normalizedAxis = canonicalizeVariantAxis(axis);
    if (!normalizedAxis) {
      return;
    }
    hasUserInteractedRef.current = true;
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

    clearAddToCartBlockedAttempt();
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

  function handleQuerySelectionSync(
    nextSelection: OgabasseyPdpCriticalQuerySelectionSync
  ) {
    if (hasUserInteractedRef.current) {
      return;
    }

    setQueryRouteOfferOverride((current) => {
      if (
        current?.initialOfferId === nextSelection.initialOfferId &&
        current?.routeOfferMissing === nextSelection.routeOfferMissing
      ) {
        return current;
      }

      return {
        initialOfferId: nextSelection.initialOfferId,
        routeOfferMissing: nextSelection.routeOfferMissing,
      };
    });

    if (nextSelection.initialVariantSelection) {
      const nextIntent = buildCriticalInitialVariantIntent({
        attributes: nextSelection.initialVariantSelection.attributes,
        condition: nextSelection.initialVariantSelection.condition,
        requiredAxes: [...requiredVariantAxes, ...renderableVariantAxes],
      });
      const { initialDisplayVariantSelection: nextDisplaySelection } =
        resolveCriticalDefaultAndDisplaySelection({
          explicitVariantCondition: nextIntent.explicitCondition,
          initialResolverAttributes: nextIntent.resolverAttributes,
          initialVariantSelection: nextSelection.initialVariantSelection,
          selectionCartProduct,
          variants,
        });

      setSelectedVariantId(nextSelection.initialVariantSelection.variantId);
      setExplicitSelectedAxes(nextIntent.explicitSelectedAxes);
      setSelectedAttributes(
        pickInitialSelectedAttributes({
          explicitAttributes: nextIntent.selectedAttributes,
          fallbackAxisOptions: variantAxisOptions,
          renderableVariantAxes,
          selection: nextDisplaySelection,
        })
      );
    }
  }

  return (
    <OgabasseyPdpCriticalQuerySyncContext.Provider
      value={handleQuerySelectionSync}
    >
      <OgabasseyPdpCriticalCommerceContext.Provider
        value={{
          ...addToCartControls,
          canAddToCart,
          currency,
          explicitSelectedAxes,
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
    </OgabasseyPdpCriticalQuerySyncContext.Provider>
  );
}

export function OgabasseyPdpCriticalQuerySync({
  initialOfferId,
  initialVariantSelection,
  routeOfferMissing,
}: OgabasseyPdpCriticalQuerySelectionSync) {
  const syncQuerySelection = useContext(OgabasseyPdpCriticalQuerySyncContext);
  const lastSyncedKeyRef = useRef<string | null>(null);
  const sortedAttributes = Object.entries(
    initialVariantSelection?.attributes ?? {}
  ).sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));
  const syncKey = JSON.stringify({
    attributes: sortedAttributes,
    condition: initialVariantSelection?.condition ?? null,
    initialOfferId: initialOfferId ?? null,
    routeOfferMissing: Boolean(routeOfferMissing),
    variantId: initialVariantSelection?.variantId ?? null,
  });

  useLayoutEffect(() => {
    if (!syncQuerySelection || lastSyncedKeyRef.current === syncKey) {
      return;
    }

    lastSyncedKeyRef.current = syncKey;
    syncQuerySelection({
      initialOfferId,
      initialVariantSelection,
      routeOfferMissing,
    });
  }, [
    initialOfferId,
    initialVariantSelection,
    routeOfferMissing,
    syncKey,
    syncQuerySelection,
  ]);

  return null;
}
