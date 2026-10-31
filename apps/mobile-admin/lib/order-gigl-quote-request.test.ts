import { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ getQuote: vi.fn(), saveAddress: vi.fn() }));
vi.mock('./order-gigl-shipping', () => ({
  getOrderGiglQuote: api.getQuote,
  saveOrderGiglShippingAddress: api.saveAddress,
}));

import {
  readCachedOrderGiglPreview,
  requestOrderGiglQuote,
} from './order-gigl-quote-request';

const draft = {
  address: '1 Allen',
  city: 'Ikeja',
  phone: '0801',
  state: 'Lagos',
};
const signal = new AbortController().signal;
const freshResult = () => ({
  availableBalance: 0,
  canBook: false,
  quote: {
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    price: 11000,
  },
  shortfall: 11000,
});

describe('requestOrderGiglQuote', () => {
  beforeEach(() => {
    api.getQuote.mockReset();
    api.saveAddress.mockReset();
    api.getQuote.mockImplementation(async () => freshResult());
  });

  it('requests a direct preview when no cache scope is provided', async () => {
    await requestOrderGiglQuote({
      draft,
      orderId: 'order-1',
      preview: true,
      queryClient: new QueryClient(),
      signal,
    });
    expect(api.getQuote).toHaveBeenCalledWith('order-1', draft, signal, true);
    expect(api.saveAddress).not.toHaveBeenCalled();
  });

  it('shares cached previews and exposes them for an immediate read', async () => {
    const queryClient = new QueryClient();
    const input = {
      cacheScope: 'scope',
      draft,
      orderId: 'order-1',
      preview: true,
      queryClient,
      signal,
    };
    expect(readCachedOrderGiglPreview(input)).toBeNull();
    await requestOrderGiglQuote(input);
    await requestOrderGiglQuote(input);
    expect(api.getQuote).toHaveBeenCalledOnce();
    expect(readCachedOrderGiglPreview(input)?.quote.price).toBe(11000);
    expect(
      readCachedOrderGiglPreview({ ...input, draft: { address: '1 Allen' } })
    ).toBeNull();
  });

  it('keeps the legacy receiver override when the stored order is unknown', async () => {
    await requestOrderGiglQuote({
      draft,
      orderId: 'order-1',
      preview: false,
      queryClient: new QueryClient(),
      signal,
    });
    expect(api.getQuote).toHaveBeenCalledWith('order-1', draft, signal);
  });

  it('saves typed details before binding without an override', async () => {
    const onAddressSaved = vi.fn();
    await requestOrderGiglQuote({
      draft,
      onAddressSaved,
      orderId: 'order-1',
      preview: false,
      queryClient: new QueryClient(),
      signal,
      storedOrder: {
        shipping_address: { address: '1 Allen', name: 'Ada', phone: '0801' },
      },
    });
    const saved = { ...draft, name: 'Ada' };
    expect(api.saveAddress).toHaveBeenCalledWith('order-1', saved, signal);
    expect(onAddressSaved).toHaveBeenCalledWith(saved);
    expect(api.getQuote).toHaveBeenCalledWith('order-1', undefined, signal);
    expect(api.saveAddress.mock.invocationCallOrder[0]).toBeLessThan(
      api.getQuote.mock.invocationCallOrder[0] ?? 0
    );
  });

  it('does not bind when saving the address fails', async () => {
    api.saveAddress.mockRejectedValue(new Error('Order not found'));
    await expect(
      requestOrderGiglQuote({
        draft,
        orderId: 'order-1',
        preview: false,
        queryClient: new QueryClient(),
        signal,
        storedOrder: { shipping_address: { address: '1 Allen', name: 'Ada' } },
      })
    ).rejects.toThrow('Order not found');
    expect(api.getQuote).not.toHaveBeenCalled();
  });

  it('binds an incomplete draft without saving so the server reports missing fields', async () => {
    await requestOrderGiglQuote({
      draft: { address: '1 Allen' },
      orderId: 'order-1',
      preview: false,
      queryClient: new QueryClient(),
      signal,
      storedOrder: { shipping_address: { address: '1 Allen' } },
    });
    expect(api.saveAddress).not.toHaveBeenCalled();
    expect(api.getQuote).toHaveBeenCalledWith('order-1', undefined, signal);
  });

  it('leaves orders with a saved quote on the receiver override path', async () => {
    await requestOrderGiglQuote({
      draft,
      orderId: 'order-1',
      preview: false,
      queryClient: new QueryClient(),
      signal,
      storedOrder: {
        selected_quote_id: 'quote-1',
        shipping_address: { address: '1 Allen', name: 'Ada', phone: '0801' },
      },
    });
    expect(api.saveAddress).not.toHaveBeenCalled();
    expect(api.getQuote).toHaveBeenCalledWith('order-1', draft, signal);
  });
});
