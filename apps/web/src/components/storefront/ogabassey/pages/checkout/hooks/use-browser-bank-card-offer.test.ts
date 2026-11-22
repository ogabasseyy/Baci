import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useBrowserBankCardOffer } from './use-browser-bank-card-offer';

vi.mock('@/hooks/use-toast', () => ({ toast: vi.fn() }));

function makeOfferProps(endsAt = '2099-01-01T00:00:00Z') {
  const selectMethod = vi.fn();
  const offer = {
    id: 'offer',
    eligibleProductIds: ['phone'],
    verifiedIssuerName: 'Fixture Bank',
    cardBrands: ['visa' as const],
    discountBasisPoints: 500,
    maximumDiscountKobo: 5000,
    startsAt: '2020-01-01T00:00:00Z',
    endsAt,
  };
  const financial = {
    paymentSession: {
      method: 'paystack',
      total: 1000,
      selectMethod,
      wallet: {},
    },
    summaryAmounts: {},
  } as unknown as Parameters<typeof useBrowserBankCardOffer>[0]['financial'];
  return {
    offers: [offer],
    cart: [{ id: 'phone', name: 'Phone', quantity: 1, price: 1000 }],
    fees: [],
    available: true,
    formatCurrency: String,
    isOrderInFlightRef: { current: false },
    financial,
  };
}

it('holds a selected offer when eligibility is lost and blocks submitting a different total', () => {
  const props = makeOfferProps();
  const [offer] = props.offers;
  const { result, rerender } = renderHook(
    ({ available }) => useBrowserBankCardOffer({ ...props, available }),
    { initialProps: { available: true } }
  );
  act(() => result.current.model.select(offer.id));
  expect(props.financial.paymentSession.selectMethod).toHaveBeenCalledWith(
    'paystack'
  );
  expect(result.current.presentation.paymentSession.total).toBe(950);
  rerender({ available: false });
  const submit = vi.fn();
  result.current.submit(submit);
  expect(submit).not.toHaveBeenCalled();
  act(() => result.current.model.select(null));
  result.current.submit(submit);
  expect(submit).toHaveBeenCalledOnce();
});

it('expires a selected offer even if the shopper leaves checkout idle', () => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date('2026-11-21T00:00:00Z'));
    const props = makeOfferProps('2026-11-21T00:00:01Z');
    const { result } = renderHook(() => useBrowserBankCardOffer(props));
    act(() => result.current.model.select('offer'));
    expect(result.current.offer?.payableKobo).toBe(95000);

    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.offer).toBeNull();
    expect(result.current.model.options).toHaveLength(0);
    expect(result.current.model.selectedId).toBe('offer');
  } finally {
    vi.useRealTimers();
  }
});

it('blocks an expired offer before a delayed background timer can refresh the choices', () => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date('2026-11-21T00:00:00Z'));
    const props = makeOfferProps('2026-11-21T00:00:01Z');
    const { result } = renderHook(() => useBrowserBankCardOffer(props));
    act(() => result.current.model.select('offer'));
    vi.setSystemTime(new Date('2026-11-21T00:00:02Z'));
    const placeOrder = vi.fn();

    act(() => {
      result.current.submit(placeOrder);
    });
    expect(placeOrder).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});
