import { router, useIsFocused } from 'expo-router';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { useCheckoutIdentityOverlay } from '@/components/checkout/checkout-identity/useCheckoutIdentityOverlay';
import { useCartCheckoutIdentityRecovery } from './use-cart-checkout-identity-recovery';
import { useCartCheckoutRecovery } from './use-cart-checkout-recovery';

export function useCartCheckoutFlow({
  isAuthenticated,
  isPriceChangeVisible,
  hasCart = true,
}: {
  isAuthenticated: boolean;
  isPriceChangeVisible: boolean;
  hasCart?: boolean;
}) {
  const {
    isOpen: isIdentityModalOpen,
    open: openCheckoutIdentity,
    close: closeCheckoutIdentity,
  } = useCheckoutIdentityOverlay();
  const isRouteFocused = useIsFocused();
  const isPriceChangeVisibleRef = useRef(isPriceChangeVisible);
  const ownsIdentityModal = useRef(false);
  const closeIdentityModalRef = useRef(closeCheckoutIdentity);

  useLayoutEffect(() => {
    isPriceChangeVisibleRef.current = isPriceChangeVisible;
  }, [isPriceChangeVisible]);

  useLayoutEffect(() => {
    closeIdentityModalRef.current = closeCheckoutIdentity;
  }, [closeCheckoutIdentity]);

  useEffect(
    () => () => {
      if (!ownsIdentityModal.current) return;
      ownsIdentityModal.current = false;
      closeIdentityModalRef.current();
    },
    []
  );

  useEffect(() => {
    if (!isIdentityModalOpen) {
      ownsIdentityModal.current = false;
      return;
    }
    // Only the Cart route that opened the global sheet may close it. Other
    // mounted Cart routes can be unfocused while this owner is still active.
    if (ownsIdentityModal.current && (!isRouteFocused || !hasCart)) {
      ownsIdentityModal.current = false;
      closeCheckoutIdentity();
    }
  }, [closeCheckoutIdentity, hasCart, isIdentityModalOpen, isRouteFocused]);

  const { recoverCheckout, isPreparing } = useCartCheckoutRecovery(() => {
    if (isPriceChangeVisibleRef.current) return;
    if (isAuthenticated) {
      router.push('/checkout');
      return;
    }
    ownsIdentityModal.current = true;
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
