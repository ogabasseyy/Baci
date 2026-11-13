import { useContext } from 'react';
import { CheckoutIdentityOverlayContext } from './CheckoutIdentityOverlayContext';

export function useCheckoutIdentityOverlay() {
  const context = useContext(CheckoutIdentityOverlayContext);
  if (!context) {
    throw new Error(
      'useCheckoutIdentityOverlay must be used inside CheckoutIdentityOverlayProvider.'
    );
  }
  return context;
}
