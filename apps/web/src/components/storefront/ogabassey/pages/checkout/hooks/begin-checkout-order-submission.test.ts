import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { executeResumedDirectPayment } from '../handlers/direct-payment';
import { submitPreparedCheckout } from '../handlers/submit-prepared-checkout';
import { prepareCheckoutOrderSubmission } from '../prepare-checkout-order-submission';
import { createContext } from './checkout-order-submission.test-support';
import { useCheckoutOrderSubmission } from './use-checkout-order-submission';

vi.mock('@/hooks/use-toast', () => ({ toast: vi.fn() }));
vi.mock('../handlers/direct-payment', () => ({
  executeResumedDirectPayment: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../handlers/submit-prepared-checkout', () => ({
  submitPreparedCheckout: vi.fn(),
}));
vi.mock('../prepare-checkout-order-submission', () => ({
  prepareCheckoutOrderSubmission: vi.fn(() => ({
    kind: 'issue',
    issue: 'incomplete-address',
  })),
}));
afterEach(() => vi.clearAllMocks());

it.each([
  false,
  true,
])('rejects invalid delivery at submission even with a matching restored quote (resume=%s)', async (resume) => {
  const context = createContext();
  if (!resume) context.resumed.order = null;
  context.cart.checkoutCart = [
    {
      id: 'fixture-product',
      name: 'Test product',
      quantity: 1,
      price: 1000,
    } as (typeof context.cart.checkoutCart)[number],
  ];
  context.delivery.session.validation.isValid = false;
  context.delivery.session.quotes.selectedId = 'fixture-gigl-quote';
  context.delivery.session.quotes.matchesSelectedMethod = true;
  const { result } = renderHook(() => useCheckoutOrderSubmission(context));

  await act(async () => result.current.handlePlaceOrder());

  expect(prepareCheckoutOrderSubmission).not.toHaveBeenCalled();
  expect(submitPreparedCheckout).not.toHaveBeenCalled();
  expect(executeResumedDirectPayment).not.toHaveBeenCalled();
  expect(context.navigation.setCurrentStep).toHaveBeenCalledWith('delivery');
  expect(context.processing.releaseSubmission).toHaveBeenCalled();
  expect(context.processing.isOrderInFlightRef.current).toBe(false);
});

it('continues payment for an existing order with no active cart without requiring a fresh delivery quote', async () => {
  const context = createContext();
  context.delivery.session.validation.isValid = false;
  const { result } = renderHook(() => useCheckoutOrderSubmission(context));

  await act(async () => result.current.handlePlaceOrder());

  expect(executeResumedDirectPayment).toHaveBeenCalledOnce();
  expect(prepareCheckoutOrderSubmission).not.toHaveBeenCalled();
  expect(submitPreparedCheckout).not.toHaveBeenCalled();
});
