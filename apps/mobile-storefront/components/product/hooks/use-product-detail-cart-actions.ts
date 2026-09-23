import { useEffect, useRef, useState } from 'react';
import type { GestureResponderEvent } from 'react-native';
import { Alert, Dimensions } from 'react-native';
import { useHaptics } from '@/hooks/use-haptics';
import { resolveCartItemImageUrl } from '@/lib/cart-display';
import { findMatchingConditionOffer } from '@/lib/product-condition-offers';
import { trackProductRouteAddToCart } from '@/services/tiktok-product-route-tracking';
import type { useProductDetailCartState } from './use-product-detail-cart-state';
import type { useProductDetailPurchaseState } from './use-product-detail-purchase-state';
import type { useProductDetailRouteData } from './use-product-detail-route-data';

type CartState = ReturnType<typeof useProductDetailCartState>;
type PurchaseState = ReturnType<typeof useProductDetailPurchaseState>;
type RouteData = ReturnType<typeof useProductDetailRouteData>;

export function useProductDetailCartActions(
  routeData: RouteData,
  cartState: CartState,
  purchaseState: PurchaseState
) {
  const haptics = useHaptics();
  const [localQty, setLocalQty] = useState(cartState.quantityInCart.toString());
  const [showAddedToast, setShowAddedToast] = useState(false);
  const [flyingParticles, setFlyingParticles] = useState<
    { id: number; startX: number; startY: number }[]
  >([]);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const particleIdRef = useRef(0);
  const particleTimersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(
    new Map()
  );

  // Sync the editable quantity field during render when the cart quantity
  // changes (prev-compare pattern; avoids a stale frame from an effect).
  const [prevQuantityInCart, setPrevQuantityInCart] = useState(
    cartState.quantityInCart
  );
  if (cartState.quantityInCart !== prevQuantityInCart) {
    setPrevQuantityInCart(cartState.quantityInCart);
    setLocalQty(cartState.quantityInCart.toString());
  }

  useEffect(
    () => () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      for (const timerId of particleTimersRef.current.values()) {
        clearTimeout(timerId);
      }
      particleTimersRef.current.clear();
    },
    []
  );

  const triggerFlyToCart = (event: GestureResponderEvent) => {
    const { pageX, pageY } = event?.nativeEvent || {};
    const id = ++particleIdRef.current;
    setFlyingParticles((prev) => [
      ...prev,
      {
        id,
        startX: pageX ?? Dimensions.get('window').width / 2,
        startY: pageY ?? Dimensions.get('window').height - 100,
      },
    ]);
    const timerId = setTimeout(() => {
      setFlyingParticles((prev) => prev.filter((p) => p.id !== id));
      particleTimersRef.current.delete(id);
    }, 1000);
    particleTimersRef.current.set(id, timerId);
  };

  const handleLocalQtyChange = (text: string) => {
    const cleanText = text.replace(/[^0-9]/g, '');
    setLocalQty(cleanText);
    const num = Number.parseInt(cleanText, 10);
    if (!Number.isNaN(num) && num > 0 && cartState.cartItem) {
      cartState.updateQuantity(cartState.cartItem.id, num);
    }
  };

  const handleLocalQtyBlur = () => {
    const num = Number.parseInt(localQty, 10);
    if (Number.isNaN(num) || num <= 0) {
      setLocalQty(cartState.quantityInCart.toString());
    } else if (cartState.cartItem) {
      cartState.updateQuantity(cartState.cartItem.id, num);
    }
  };

  const handleAddToCart = (event?: GestureResponderEvent) => {
    const product = routeData.product;
    if (!product) return;
    if (
      product.has_variants &&
      !purchaseState.resolvedVariantPurchaseSelection
    ) {
      Alert.alert(
        'Select Variant',
        'Choose an available storage option before adding this item to your cart.'
      );
      return;
    }
    if (!purchaseState.canPurchase) {
      Alert.alert(
        'Out of Stock',
        'This exact selection is currently unavailable. Try a different condition or variant.'
      );
      return;
    }

    haptics.success();
    if (event) triggerFlyToCart(event);
    const variantAttrs: Record<string, string> = {};
    if (routeData.effectiveSelectedColor) {
      variantAttrs.color = routeData.effectiveSelectedColor;
    }
    if (routeData.effectiveSelectedStorage) {
      variantAttrs.storage = routeData.effectiveSelectedStorage;
    }
    for (const [axis, value] of Object.entries(
      routeData.effectiveSelectedAttributes
    )) {
      if (value) variantAttrs[axis] = value;
    }
    const conditionDisplay = cartState.getConditionDisplay();
    if (conditionDisplay) variantAttrs.condition = conditionDisplay;
    // Color is carried into the cart by the image: prefer the selected color's
    // own image so the cart always depicts the chosen color, even when the
    // gallery is still showing a non-color default frame (e.g. an open-box
    // hero shot). Falls back to the displayed frame when no color image exists.
    const selectedColorImage = routeData.effectiveSelectedColor
      ? routeData.resolvedColorImages?.[routeData.effectiveSelectedColor]?.find(
          Boolean
        )
      : undefined;
    // Non-variant condition offers price the line below catalog, but the
    // server verifies against products.price. Retain the catalog basis so
    // quote subtotals match the canonical subtotal.
    const conditionOffer = !product.has_variants
      ? findMatchingConditionOffer(product.offers, routeData.offerConditionKey)
      : null;
    cartState.addItem({
      product_id: product.id,
      slug: product.slug,
      variant_id: routeData.effectiveSelectedVariantId || undefined,
      variant_attributes:
        Object.keys(variantAttrs).length > 0 ? variantAttrs : undefined,
      name: product.name,
      brand: product.brand,
      price: purchaseState.effectivePrice,
      catalog_price:
        conditionOffer != null &&
        typeof product.price === 'number' &&
        Number.isFinite(product.price) &&
        product.price >= 0
          ? product.price
          : undefined,
      compare_at_price: purchaseState.effectiveComparePrice,
      quantity: 1,
      image_url: resolveCartItemImageUrl({
        displayedImageUrl:
          selectedColorImage ||
          routeData.productGalleryImages[routeData.selectedImageIndex] ||
          routeData.productGalleryImages[0],
        variantImageUrl:
          routeData.currentVariantDisplaySelection?.variant.image,
        variantImages: routeData.currentVariantDisplaySelection?.variant.images,
        fallbackImageUrl: product.image,
      }),
      color: routeData.effectiveSelectedColor || undefined,
      storage: routeData.effectiveSelectedStorage || undefined,
      condition: conditionDisplay,
      variant_name: routeData.currentVariantDisplaySelection?.variant.name,
    });
    void trackProductRouteAddToCart(product, purchaseState.effectivePrice);
    setShowAddedToast(true);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => {
      setShowAddedToast(false);
      toastTimerRef.current = null;
    }, 2000);
  };

  const handleUpdateQuantity = (
    newQuantity: number,
    event?: GestureResponderEvent
  ) => {
    haptics.light();
    if (newQuantity > cartState.quantityInCart && event)
      triggerFlyToCart(event);
    if (cartState.cartItem) {
      if (newQuantity <= 0) cartState.removeItem(cartState.cartItem.id);
      else cartState.updateQuantity(cartState.cartItem.id, newQuantity);
    } else if (newQuantity > 0) {
      handleAddToCart();
    }
  };

  return {
    flyingParticles,
    handleAddToCart,
    handleLocalQtyBlur,
    handleLocalQtyChange,
    handleUpdateQuantity,
    localQty,
    showAddedToast,
  };
}
