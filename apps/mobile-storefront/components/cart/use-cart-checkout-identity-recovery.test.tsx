import { act, renderHook, waitFor } from '@testing-library/react-native';
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
  const recoverCheckout = jest.fn(async () => {});
  const { result, rerender, unmount } = renderHook(
    ({ isAuthenticated }: { isAuthenticated: boolean }) =>
      useCartCheckoutIdentityRecovery(isAuthenticated, recoverCheckout),
    { initialProps: { isAuthenticated: false } }
  );

  act(() => result.current());
  act(() => jest.advanceTimersByTime(60_000));
  rerender({ isAuthenticated: true });

  expect(recoverCheckout).not.toHaveBeenCalled();
  unmount();
  jest.useRealTimers();
});
