import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useBrowserBankCardOffer } from './use-browser-bank-card-offer';

vi.mock('@/hooks/use-toast', () => ({ toast: vi.fn() }));

it('holds a selected offer when eligibility is lost and blocks submitting a different total', () => {
  const selectMethod = vi.fn();
  const offer = {
    id: 'offer',
    eligibleProductIds: ['phone'],
    verifiedIssuerName: 'Fixture Bank',
    cardBrands: ['visa' as const],
    discountBasisPoints: 500,
    maximumDiscountKobo: 5000,
    startsAt: '2020-01-01T00:00:00Z',
    endsAt: '2099-01-01T00:00:00Z',
  };
  const { result, rerender } = renderHook(
    ({ available }) =>
      useBrowserBankCardOffer({
        offers: [offer],
        cart: [{ id: 'phone', name: 'Phone', quantity: 1, price: 1000 }],
        fees: [],
        available,
        formatCurrency: String,
        isOrderInFlightRef: { current: false },
        financial: {
          paymentSession: {
            method: 'paystack',
            total: 1000,
            selectMethod,
            wallet: {},
          },
          summaryAmounts: {},
        } as unknown as Parameters<
          typeof useBrowserBankCardOffer
        >[0]['financial'],
      }),
    { initialProps: { available: true } }
  );
  act(() => result.current.model.select(offer.id));
  expect(selectMethod).toHaveBeenCalledWith('paystack');
  expect(result.current.presentation.paymentSession.total).toBe(950);
  rerender({ available: false });
  const submit = vi.fn();
  result.current.submit(submit);
  expect(submit).not.toHaveBeenCalled();
  act(() => result.current.model.select(null));
  result.current.submit(submit);
  expect(submit).toHaveBeenCalledOnce();
});
