import { fireEvent, render, screen } from '@testing-library/react';
import { useContext } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { OxygenOrderConfirmationRedirect } from './OxygenOrderConfirmationRedirect';
import { OxygenOrderConfirmationContext } from './OxygenPaymentSurfaceContext';

const mocks = vi.hoisted(() => ({ replace: vi.fn(), merchant: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mocks.replace }),
}));
vi.mock('@/hooks/use-merchant-client', () => ({
  useMerchantSafe: mocks.merchant,
}));
function Completion() {
  const complete = useContext(OxygenOrderConfirmationContext);
  return (
    <button type="button" onClick={complete}>
      Simulate confirmed activation
    </button>
  );
}
beforeEach(() => {
  vi.resetAllMocks();
});
it.each([
  '/shop',
  '',
])('navigates once using the merchant base path %s', (basePath) => {
  mocks.merchant.mockReturnValue({ basePath });
  render(
    <OxygenOrderConfirmationRedirect orderId="same-order" merchantSlug="shop">
      <Completion />
    </OxygenOrderConfirmationRedirect>
  );
  expect(mocks.replace).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button'));
  fireEvent.click(screen.getByRole('button'));
  expect(mocks.replace).toHaveBeenCalledExactlyOnceWith(
    `${basePath}/order-success?orderId=same-order&type=oxygen`
  );
});
it('falls back to the supplied store slug without sending a token or marking an order paid', () => {
  mocks.merchant.mockReturnValue(null);
  render(
    <OxygenOrderConfirmationRedirect orderId="same-order" merchantSlug="shop">
      <Completion />
    </OxygenOrderConfirmationRedirect>
  );
  fireEvent.click(screen.getByRole('button'));
  expect(mocks.replace).toHaveBeenCalledWith(
    '/shop/order-success?orderId=same-order&type=oxygen'
  );
});
