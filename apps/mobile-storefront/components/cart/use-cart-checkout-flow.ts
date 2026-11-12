import { router, useIsFocused } from 'expo-router';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { useCheckoutIdentityOverlay } from '@/components/checkout/checkout-identity/useCheckoutIdentityOverlay';
import { useCartCheckoutIdentityRecovery } from './use-cart-checkout-identity-recovery';
import { useCartCheckoutRecovery } from './use-cart-checkout-recovery';

export function useCartCheckoutFlow({
  isAuthenticated,
  isPriceChangeVisible,
}: {
  isAuthenticated: boolean;
  isPriceChangeVisible: boolean;
}) {
  const {
    isOpen: isIdentityModalOpen,
    open: openCheckoutIdentity,
    close: closeCheckoutIdentity,
  } = useCheckoutIdentityOverlay();
  const isRouteFocused = useIsFocused();
  const isPriceChangeVisibleRef = useRef(isPriceChangeVisible);

  useLayoutEffect(() => {
    isPriceChangeVisibleRef.current = isPriceChangeVisible;
  }, [isPriceChangeVisible]);

  useEffect(() => {
    // Losing Cart focus cancels its identity continuation; a later auth result
    // must not push Checkout over the route the customer moved to.
    if (!isRouteFocused && isIdentityModalOpen) closeCheckoutIdentity();
  }, [closeCheckoutIdentity, isIdentityModalOpen, isRouteFocused]);

  const { recoverCheckout, isPreparing } = useCartCheckoutRecovery(() => {
    if (isPriceChangeVisible) return;
    if (isAuthenticated) {
      router.push('/checkout');
      return;
    }
    openCheckoutIdentity(onCheckoutIdentityVerified, () => {
      void recoverCheckout(() => {
        if (!isPriceChangeVisibleRef.current) router.push('/checkout');
      });
    });
  });
  const onCheckoutIdentityVerified = useCartCheckoutIdentityRecovery(
    isAuthenticated,
    recoverCheckout,
    isRouteFocused
  );

  return { isIdentityModalOpen, isPreparing, recoverCheckout };
}
