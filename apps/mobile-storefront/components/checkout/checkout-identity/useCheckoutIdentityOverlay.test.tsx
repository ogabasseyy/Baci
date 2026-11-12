import { renderHook } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { CheckoutIdentityOverlayContext } from './CheckoutIdentityOverlayContext';
import { useCheckoutIdentityOverlay } from './useCheckoutIdentityOverlay';

it('returns the provider value to consumers', () => {
  const open = jest.fn();
  const close = jest.fn();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <CheckoutIdentityOverlayContext.Provider
      value={{ isOpen: true, open, close }}
    >
      {children}
    </CheckoutIdentityOverlayContext.Provider>
  );

  const { result } = renderHook(() => useCheckoutIdentityOverlay(), {
    wrapper,
  });
  expect(result.current).toEqual({ isOpen: true, open, close });
});

it('throws outside the provider', () => {
  expect(() => renderHook(() => useCheckoutIdentityOverlay())).toThrow(
    'useCheckoutIdentityOverlay must be used inside CheckoutIdentityOverlayProvider.'
  );
});
