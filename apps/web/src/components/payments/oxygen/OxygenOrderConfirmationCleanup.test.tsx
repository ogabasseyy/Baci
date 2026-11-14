import { fireEvent, render, screen } from '@testing-library/react';
import { useContext } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  cleanup: vi.fn().mockResolvedValue(undefined),
  replace: vi.fn(),
  cart: vi.fn(() => null as null | { isHydrated: boolean }),
}));
vi.mock('@/hooks/cart', () => ({ useCartSafe: mocks.cart }));
vi.mock('./oxygen-checkout-cleanup', () => ({
  cleanupOxygenCompletedCheckout: mocks.cleanup,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mocks.replace }),
}));
vi.mock('@/hooks/use-merchant-client', () => ({
  useMerchantSafe: () => ({ basePath: '/shop' }),
}));

import { OxygenOrderConfirmationRedirect } from './OxygenOrderConfirmationRedirect';
import { OxygenOrderConfirmationContext } from './OxygenPaymentSurfaceContext';

function Completion() {
  const complete = useContext(OxygenOrderConfirmationContext);
  return (
    <button type="button" onClick={complete}>
      Confirm
    </button>
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.cart.mockReturnValue(null);
});
it('cleans the exact completed order once before redirecting', () => {
  render(
    <OxygenOrderConfirmationRedirect
      orderId="order-1"
      merchantId="merchant-1"
      merchantSlug="shop"
    >
      <Completion />
    </OxygenOrderConfirmationRedirect>
  );
  expect(mocks.cleanup).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button'));
  fireEvent.click(screen.getByRole('button'));
  expect(mocks.cleanup).toHaveBeenCalledExactlyOnceWith(
    'order-1',
    'merchant-1',
    { merchantSlug: 'shop', cart: null }
  );
  expect(mocks.replace).toHaveBeenCalledOnce();
});

it('waits for the local cart to hydrate before cleanup and navigation', () => {
  mocks.cart.mockReturnValue({ isHydrated: false });
  const view = render(
    <OxygenOrderConfirmationRedirect
      orderId="order-1"
      merchantId="merchant-1"
      merchantSlug="shop"
    >
      <Completion />
    </OxygenOrderConfirmationRedirect>
  );
  fireEvent.click(screen.getByRole('button'));
  expect(mocks.cleanup).not.toHaveBeenCalled();
  expect(mocks.replace).not.toHaveBeenCalled();
  mocks.cart.mockReturnValue({ isHydrated: true });
  view.rerender(
    <OxygenOrderConfirmationRedirect
      orderId="order-1"
      merchantId="merchant-1"
      merchantSlug="shop"
    >
      <Completion />
    </OxygenOrderConfirmationRedirect>
  );
  expect(mocks.cleanup).toHaveBeenCalledOnce();
  expect(mocks.replace).toHaveBeenCalledOnce();
});
