import { act, renderHook, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { CHECKOUT_IDENTITY_RESUME_TIMEOUT_MS } from './checkout-recovery.constants';
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
  act(() => jest.advanceTimersByTime(CHECKOUT_IDENTITY_RESUME_TIMEOUT_MS));
  rerender({ isAuthenticated: true, isRouteFocused: true });

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
  act(() => jest.advanceTimersByTime(CHECKOUT_IDENTITY_RESUME_TIMEOUT_MS));

  expect(alert).not.toHaveBeenCalled();
  unmount();
  alert.mockRestore();
  jest.useRealTimers();
});

it('keeps authenticated recovery pending until Cart is focused again', async () => {
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
  rerender({ isAuthenticated: true, isRouteFocused: false });
  act(() => jest.advanceTimersByTime(CHECKOUT_IDENTITY_RESUME_TIMEOUT_MS));
  expect(recoverCheckout).not.toHaveBeenCalled();
  expect(alert).not.toHaveBeenCalled();

  rerender({ isAuthenticated: true, isRouteFocused: true });
  await waitFor(() => expect(recoverCheckout).toHaveBeenCalledTimes(1));
  unmount();
  alert.mockRestore();
  jest.useRealTimers();
});

it('clears a retained resume after sign-out when its timeout expired unfocused', () => {
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
  rerender({ isAuthenticated: true, isRouteFocused: false });
  act(() => jest.advanceTimersByTime(CHECKOUT_IDENTITY_RESUME_TIMEOUT_MS));
  rerender({ isAuthenticated: false, isRouteFocused: false });
  rerender({ isAuthenticated: true, isRouteFocused: true });

  expect(recoverCheckout).not.toHaveBeenCalled();
  expect(alert).not.toHaveBeenCalled();
  unmount();
  alert.mockRestore();
  jest.useRealTimers();
});
