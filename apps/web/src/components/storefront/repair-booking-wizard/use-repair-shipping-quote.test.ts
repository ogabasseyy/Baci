import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useRepairShippingQuote } from './use-repair-shipping-quote';

const mocks = vi.hoisted(() => ({ calculate: vi.fn() }));

vi.mock('@/app/actions/repair', () => ({
  calculateRepairShipping: mocks.calculate,
}));

const place = {
  city: 'Osogbo',
  country: 'Nigeria',
  formattedAddress: '12 Station Road, Osogbo, Osun, Nigeria',
  route: 'Station Road',
  state: 'Osun',
  streetNumber: '12',
  zip: '',
};

describe('useRepairShippingQuote', () => {
  it('retains the selected address so a rejected quote can be retried', async () => {
    mocks.calculate
      .mockRejectedValueOnce(new Error('carrier unavailable'))
      .mockResolvedValueOnce({
        formattedPrice: '₦8,250',
        isFree: false,
        price: 8250,
      });
    const { result } = renderHook(() => useRepairShippingQuote('ogabassey'));

    await act(() => result.current.selectAddress(place));
    expect(result.current.shippingQuote?.error).toMatch(/try again/i);

    await act(() => result.current.retry());

    await waitFor(() => expect(result.current.shippingQuote?.price).toBe(8250));
    expect(mocks.calculate).toHaveBeenCalledTimes(2);
    expect(mocks.calculate).toHaveBeenLastCalledWith(place, 'ogabassey');
  });

  it('keeps the newest address quote when requests resolve out of order', async () => {
    let resolveFirst: (value: unknown) => void = () => undefined;
    mocks.calculate
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFirst = resolve;
        })
      )
      .mockResolvedValueOnce({
        formattedPrice: '₦4,000',
        isFree: false,
        price: 4000,
      });
    const { result } = renderHook(() => useRepairShippingQuote('ogabassey'));

    let firstRequest: Promise<void> | undefined;
    act(() => {
      firstRequest = result.current.selectAddress(place);
    });
    await act(() =>
      result.current.selectAddress({
        ...place,
        formattedAddress: 'New address',
      })
    );
    await act(async () => {
      resolveFirst({ formattedPrice: '₦8,250', isFree: false, price: 8250 });
      await firstRequest;
    });

    expect(result.current.shippingQuote?.price).toBe(4000);
  });
});
