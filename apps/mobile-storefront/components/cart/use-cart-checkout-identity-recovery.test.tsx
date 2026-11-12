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
