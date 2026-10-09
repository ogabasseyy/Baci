import { useShallow } from 'zustand/react/shallow';
import { findMatchingConditionOffer } from '@/lib/product-condition-offers';
import { useCartStore } from '@/stores/cart-store';
import { formatProductConditionDisplay } from '@/types/product';
import type { useProductDetailRouteData } from './use-product-detail-route-data';

type RouteData = ReturnType<typeof useProductDetailRouteData>;

export function useProductDetailCartState(routeData: RouteData) {
  const { items, addItem, updateQuantity, removeItem } = useCartStore(
    useShallow((state) => ({
      items: state.items,
      addItem: state.addItem,
      updateQuantity: state.updateQuantity,
      removeItem: state.removeItem,
    }))
  );
  const getConditionDisplay = (): string | undefined => {
    if (routeData.effectiveSelectedAttributes.condition) {
      return formatProductConditionDisplay(
        routeData.effectiveSelectedAttributes.condition
      );
    }
    if (routeData.currentVariantDisplaySelection?.condition) {
      return formatProductConditionDisplay(
        routeData.currentVariantDisplaySelection.condition
      );
    }
    if (routeData.offerConditionKey) {
      return formatProductConditionDisplay(routeData.offerConditionKey);
    }
    return routeData.product?.condition;
  };
  // Resolve the same condition offer the add path stamps onto the line:
  // lines split by offer id, so matching on condition alone would merge
  // two same-condition offers into the first line's quantity.
  const conditionOffer =
    routeData.product && !routeData.product.has_variants
      ? findMatchingConditionOffer(
          routeData.product.offers,
          routeData.offerConditionKey,
          routeData.routeOfferId,
          routeData.suppressConditionOfferMatch
        )
      : null;
  const cartItem = routeData.product
    ? items.find(
        (item) =>
          item.product_id === routeData.product?.id &&
          (item.variant_id || null) ===
            (routeData.effectiveSelectedVariantId || null) &&
          (item.condition || null) === (getConditionDisplay() || null) &&
          (item.offer_id || null) === (conditionOffer?.id || null) &&
          (item.color || null) === (routeData.effectiveSelectedColor || null) &&
          (item.storage || null) ===
            (routeData.effectiveSelectedStorage || null)
      )
    : undefined;

  return {
    addItem,
    cartItem,
    getConditionDisplay,
    quantityInCart: cartItem ? cartItem.quantity : 0,
    removeItem,
    updateQuantity,
  };
}
