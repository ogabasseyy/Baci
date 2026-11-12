import { act, renderHook, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { useCartCheckoutIdentityRecovery } from './use-cart-checkout-identity-recovery';

it('waits for auth state to settle before recovering checkout', async () => {
  const recoverCheckout = jest.fn(async () => {});
  const { result, rerender } = renderHook(
    ({ isAuthenticated }: { isAuthenticated: boolean }) =>
      useCartCheckoutIdentityRecovery(isAuthenticated, recoverCheckout),
    { initialProps: { isAuthenticated: false } }
  );

  act(() => result.current());
  expect(recoverCheckout).not.toHaveBeenCalled();

  rerender({ isAuthenticated: true });
  await waitFor(() => expect(recoverCheckout).toHaveBeenCalledTimes(1));
});

it('expires a resume request when authentication never settles', () => {
  jest.useFakeTimers();
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const recoverCheckout = jest.fn(async () => {});
  const { result, rerender, unmount } = renderHook(
    ({
      isAuthenticated,
      isRouteFocused,
    }: {
      isAuthenticated: boolean;
      isRouteFocused: boolean;
    }) =>
      useCartCheckoutIdentityRecovery(
        isAuthenticated,
        recoverCheckout,
        isRouteFocused
      ),
    { initialProps: { isAuthenticated: false, isRouteFocused: true } }
  );

  act(() => result.current());
  act(() => jest.advanceTimersByTime(60_000));
  rerender({ isAuthenticated: true });

  expect(recoverCheckout).not.toHaveBeenCalled();
  expect(alert).toHaveBeenCalledWith(
    'Checkout not resumed',
    'Tap Checkout again to continue with your current cart.'
  );
  unmount();
  alert.mockRestore();
  jest.useRealTimers();
});

it('does not show the expiry alert after Cart loses focus', () => {
  jest.useFakeTimers();
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const recoverCheckout = jest.fn(async () => {});
  const { result, rerender, unmount } = renderHook(
    ({
      isAuthenticated,
      isRouteFocused,
    }: {
      isAuthenticated: boolean;
      isRouteFocused: boolean;
    }) =>
      useCartCheckoutIdentityRecovery(
        isAuthenticated,
        recoverCheckout,
        isRouteFocused
      ),
    { initialProps: { isAuthenticated: false, isRouteFocused: true } }
  );

  act(() => result.current());
  rerender({ isAuthenticated: false, isRouteFocused: false });
  act(() => jest.advanceTimersByTime(60_000));

  expect(alert).not.toHaveBeenCalled();
  unmount();
  alert.mockRestore();
  jest.useRealTimers();
});
