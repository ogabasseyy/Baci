import { isProductNegotiable } from '@baci/shared/lib';
import { useState } from 'react';
import { Alert } from 'react-native';
import { useShallow } from 'zustand/react/shallow';
import { getCartItemEffectivePrice } from '@/lib/cart-pricing';
import { type CartItem, useCartStore } from '@/stores/cart-store';
import { markSharedCartIntent } from '@/stores/shared-cart-writer';
import { useUIStore } from '@/stores/ui-store';

interface UseCartNegotiationParams {
  items: CartItem[];
  grandTotal: number;
}

export function useCartNegotiation({
  items,
  grandTotal,
}: UseCartNegotiationParams) {
  const [showNegotiateWarning, setShowNegotiateWarning] = useState(false);
  const [pendingNegotiateItem, setPendingNegotiateItem] =
    useState<CartItem | null>(null);

  const { openNegotiation } = useUIStore(
    useShallow((state) => ({ openNegotiation: state.openNegotiation }))
  );
  const clearNegotiatedPrice = useCartStore(
    (state) => state.clearNegotiatedPrice
  );

  const hasNonNegotiableCartItem = items.some(
    (item) => !isProductNegotiable({ brand: item.brand, name: item.name })
  );

  const actuallyOpenItemNegotiation = (item: CartItem) => {
    markSharedCartIntent();
    const priceToUse = getCartItemEffectivePrice(item);
    openNegotiation({
      type: 'single',
      itemId: item.id,
      productName:
        item.quantity > 1 ? `${item.name} (x${item.quantity})` : item.name,
      currentPrice: priceToUse * item.quantity,
      brand: item.brand,
      isNegotiable: isProductNegotiable({ brand: item.brand, name: item.name }),
      productSlug: item.slug,
      variantId: item.variant_id,
      variantName: item.variant_name,
      variantAttributes: item.variant_attributes,
      condition: item.condition,
    });
    setShowNegotiateWarning(false);
    setPendingNegotiateItem(null);
  };

  const openItemNegotiation = (item: CartItem) => {
    if (!isProductNegotiable({ brand: item.brand, name: item.name })) {
      Alert.alert('Best Price', 'This item is already at the best price.');
      return;
    }

    const hasAnyIndividualNegotiation = items.some(
      (cartItem) => cartItem.negotiatedPrice != null
    );
    const hasBulkDiscount = items.some((cartItem) => {
      const discountedItem = cartItem as CartItem & { cartDiscount?: number };
      return (discountedItem.cartDiscount ?? 0) > 0;
    });

    if (hasBulkDiscount) {
      Alert.alert(
        'Bulk Discount Active',
        'You already have a bulk discount applied. Remove it before negotiating items individually.'
      );
      return;
    }

    if (hasAnyIndividualNegotiation) {
      actuallyOpenItemNegotiation(item);
    } else {
      markSharedCartIntent();
      setPendingNegotiateItem(item);
      setShowNegotiateWarning(true);
    }
  };

  const proceedToTotalNegotiation = (total: number) => {
    markSharedCartIntent();
    openNegotiation({
      type: 'total',
      productName: 'Total Cart',
      currentPrice: total,
      isNegotiable: true,
    });
    setShowNegotiateWarning(false);
    setPendingNegotiateItem(null);
  };

  // Base (pre-negotiation) cart total, mirroring the cart screen's grand-total
  // math but ignoring any negotiated prices — used after resetting individual
  // negotiations so bulk negotiation starts from the live catalog total.
  const computeBaseGrandTotal = () =>
    items.reduce((sum, item) => {
      const lineBase = item.price * item.quantity;
      const assurance = item.hasAssurance
        ? Math.round(item.price * item.quantity * (item.assuranceRate ?? 0.05))
        : 0;
      return sum + lineBase + assurance;
    }, 0);

  const openTotalNegotiation = () => {
    if (hasNonNegotiableCartItem) {
      Alert.alert(
        'Best Price Item in Cart',
        'Cart-wide negotiation is unavailable while your cart includes a best-price item.'
      );
      return;
    }

    const itemsWithIndividualNegotiation = items.filter(
      (item) =>
        item.negotiationStatus === 'accepted' || item.negotiatedPrice != null
    );

    if (itemsWithIndividualNegotiation.length > 0) {
      Alert.alert(
        'Reset individual prices?',
        'Negotiating your whole cart will clear the prices you negotiated on individual items. Reset them and continue?',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Reset & Continue',
            style: 'destructive',
            onPress: () => {
              for (const item of itemsWithIndividualNegotiation) {
                clearNegotiatedPrice(item.id);
              }
              proceedToTotalNegotiation(computeBaseGrandTotal());
            },
          },
        ]
      );
      return;
    }

    proceedToTotalNegotiation(grandTotal);
  };

  return {
    showNegotiateWarning,
    setShowNegotiateWarning,
    pendingNegotiateItem,
    setPendingNegotiateItem,
    hasNonNegotiableCartItem,
    actuallyOpenItemNegotiation,
    openItemNegotiation,
    openTotalNegotiation,
  };
}
