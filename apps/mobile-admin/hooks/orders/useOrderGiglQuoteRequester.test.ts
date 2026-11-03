import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { createElement, type PropsWithChildren } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrderGiglStoredAddressSource } from '@/lib/order-gigl-address-save-plan';

const api = vi.hoisted(() => ({ getQuote: vi.fn(), saveAddress: vi.fn() }));
vi.mock('@/lib/order-gigl-shipping', () => ({
  getOrderGiglQuote: api.getQuote,
  saveOrderGiglShippingAddress: api.saveAddress,
}));

import { useOrderGiglQuoteRequester } from './useOrderGiglQuoteRequester';

const draft = {
  address: '1 Allen',
  city: 'Ikeja',
  phone: '0801',
  state: 'Lagos',
};
const staleOrder: OrderGiglStoredAddressSource = {
  shipping_address: { address: '1 Allen', name: 'Ada', phone: '0801' },
};
const signal = new AbortController().signal;

function renderRequester(storedOrder = staleOrder) {
  const queryClient = new QueryClient();
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const addressRef = { current: draft };
  const view = renderHook(
    ({ order }: { order: OrderGiglStoredAddressSource }) =>
      useOrderGiglQuoteRequester({ addressRef, storedOrder: order }),
    {
      initialProps: { order: storedOrder },
      wrapper: ({ children }: PropsWithChildren) =>
        createElement(QueryClientProvider, { client: queryClient }, children),
    }
  );
  return { ...view, invalidate };
}

describe('useOrderGiglQuoteRequester', () => {
  beforeEach(() => {
    api.getQuote.mockReset();
    api.saveAddress.mockReset();
    api.getQuote.mockResolvedValue({ quote: { price: 11000 } });
  });

  it('refreshes the order once the bind after an address save settles', async () => {
    const { invalidate, result } = renderRequester();
    await act(() => result.current.fetch('order-1', false, signal));

    expect(api.saveAddress).toHaveBeenCalledOnce();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['order', 'order-1'] });
    expect(invalidate.mock.invocationCallOrder[0]).toBeGreaterThan(
      api.getQuote.mock.invocationCallOrder[0] ?? 0
    );
  });

  it('still refreshes the order when the bind fails after the address was saved', async () => {
    api.getQuote.mockRejectedValueOnce(new Error('GIGL quote unavailable'));
    const { invalidate, result } = renderRequester();
    await act(async () => {
      await expect(
        result.current.fetch('order-1', false, signal)
      ).rejects.toThrow('GIGL quote unavailable');
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['order', 'order-1'] });
  });

  it('does not save again on retry while the cached order is still stale', async () => {
    const { result } = renderRequester();
    await act(() => result.current.fetch('order-1', false, signal));
    await act(() => result.current.fetch('order-1', false, signal));

    expect(api.saveAddress).toHaveBeenCalledOnce();
    expect(api.getQuote).toHaveBeenLastCalledWith('order-1', undefined, signal);
  });

  it('follows the refreshed order once it arrives', async () => {
    const { rerender, result } = renderRequester();
    await act(() => result.current.fetch('order-1', false, signal));

    rerender({
      order: {
        shipping_address: { ...draft, name: 'Ada', state: 'Ogun' },
      },
    });
    await act(() => result.current.fetch('order-1', false, signal));

    expect(api.saveAddress).toHaveBeenCalledTimes(2);
    expect(api.saveAddress).toHaveBeenLastCalledWith(
      'order-1',
      { ...draft, name: 'Ada' },
      signal
    );
  });

  it('forgets the saved address when cleared for another order', async () => {
    const { result } = renderRequester();
    await act(() => result.current.fetch('order-1', false, signal));
    act(() => result.current.clear());
    await act(() => result.current.fetch('order-1', false, signal));

    expect(api.saveAddress).toHaveBeenCalledTimes(2);
  });

  it('never saves or refreshes the order for a preview', async () => {
    const { invalidate, result } = renderRequester();
    await act(() => result.current.fetch('order-1', true, signal));

    expect(api.saveAddress).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
    expect(api.getQuote).toHaveBeenCalledWith('order-1', draft, signal, true);
  });

  it('reports the saved address as the bound address until the order is refetched', async () => {
    const { rerender, result } = renderRequester();
    const before = result.current.storedAddressSignature();
    await act(() => result.current.fetch('order-1', false, signal));

    const saved = result.current.storedAddressSignature();
    expect(saved).not.toBe(before);
    expect(saved).toBe(
      JSON.stringify(['1 Allen', 'Ikeja', 'Lagos', '0801', null, null])
    );

    // The refetched order (jsonb reorders keys) yields the same signature.
    rerender({
      order: {
        shipping_address: {
          city: 'Ikeja',
          name: 'Ada',
          phone: '0801',
          state: 'Lagos',
          address: '1 Allen',
        },
      },
    });
    expect(result.current.storedAddressSignature()).toBe(saved);
  });

  it('falls back to the customer phone like the panel does', () => {
    const { result } = renderRequester({
      customer_phone: ' 0802 ',
      shipping_address: { address: '1 Allen', phone: '' },
    });

    expect(result.current.storedAddressSignature()).toBe(
      JSON.stringify(['1 Allen', null, null, '0802', null, null])
    );
  });
});
