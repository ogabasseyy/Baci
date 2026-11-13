import { createContext } from 'react';

export interface CheckoutIdentityOverlayContextValue {
  isOpen: boolean;
  open: (onVerified?: () => void, onGuestCheckout?: () => void) => void;
  close: () => void;
}

export const CheckoutIdentityOverlayContext =
  createContext<CheckoutIdentityOverlayContextValue | null>(null);
