import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { createElement, type PropsWithChildren } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  getFundingAccount: vi.fn(),
  getOrRequestFunding: vi.fn(),
  getQuote: vi.fn(),
  getWallet: vi.fn(),
  requestFundingAccount: vi.fn(),
}));
const appState = vi.hoisted(() => ({
  listener: (() => undefined) as (state: string) => void,
}));

vi.mock('react-native', () => ({
  AppState: {
    addEventListener: (_event: string, listener: (state: string) => void) => {
      appState.listener = listener;
      return { remove: vi.fn() };
    },
  },
}));

vi.mock('@/lib/order-gigl-shipping', () => {
  class TestShippingError extends Error {}
  return {
    getMerchantWalletFundingAccount: api.getFundingAccount,
    getMerchantWalletSummary: api.getWallet,
    getOrRequestMerchantWalletFundingAccount: api.getOrRequestFunding,
    getOrderGiglQuote: api.getQuote,
    OrderGiglShippingError: TestShippingError,
    requestMerchantWalletFundingAccount: api.requestFundingAccount,
  };
});

import { useOrderGiglShipping } from './useOrderGiglShipping';
import {
  deferred,
  quoteResult,
} from './useOrderGiglShipping.lifecycle.test-support';

function wrapper({ children }: PropsWithChildren) {
  return createElement(
    QueryClientProvider,
    { client: new QueryClient() },
    children
  );
}

async function flushPromises() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('useOrderGiglShipping polling lifecycle — polling', () => {
  beforeEach(() => {
    for (const mock of Object.values(api)) mock.mockReset();
    vi.useFakeTimers();
    vi.setSystemTime('2026-09-01T17:00:00.000Z');
    api.getQuote.mockResolvedValue(quoteResult);
    api.getFundingAccount.mockResolvedValue(null);
    api.getOrRequestFunding.mockResolvedValue({
      account: null,
      status: 'pending',
    });
    appState.listener = () => undefined;
  });

  it('polls every three seconds and stops when wallet covers the quote', async () => {
    api.getQuote.mockResolvedValueOnce(quoteResult).mockResolvedValueOnce({
      ...quoteResult,
      availableBalance: 11000,
      shortfall: 0,
      canBook: true,
    });
    api.getWallet
      .mockResolvedValueOnce({ availableBalance: 5000, currency: 'NGN' })
      .mockResolvedValueOnce({ availableBalance: 11000, currency: 'NGN' });
    const { result } = renderHook(
      () => useOrderGiglShipping({ enabled: true, orderId: 'order-1' }),
      { wrapper }
    );
    await flushPromises();
    act(() => result.current.startTransferPoll());
    await act(() => vi.advanceTimersByTimeAsync(6000));
    expect(api.getWallet).toHaveBeenCalledTimes(2);
    expect(api.getQuote).toHaveBeenCalledTimes(2);
    expect(result.current.wallet?.canBook).toBe(true);
    await act(() => vi.advanceTimersByTimeAsync(6000));
    expect(api.getWallet).toHaveBeenCalledTimes(2);
  });

  it('keeps booking disabled when the replacement quote costs more', async () => {
    api.getQuote.mockResolvedValueOnce(quoteResult).mockResolvedValueOnce({
      ...quoteResult,
      quote: {
        ...quoteResult.quote,
        price: 12000,
        expiresAt: '2026-09-01T19:00:00.000Z',
      },
      availableBalance: 11000,
      shortfall: 1000,
      canBook: false,
    });
    api.getWallet.mockResolvedValue({
      availableBalance: 11000,
      currency: 'NGN',
    });
    const { result } = renderHook(
      () => useOrderGiglShipping({ enabled: true, orderId: 'order-1' }),
      { wrapper }
    );
    await flushPromises();
    act(() => result.current.startTransferPoll());
    await act(() => vi.advanceTimersByTimeAsync(3000));
    expect(result.current.quote?.price).toBe(12000);
    expect(result.current.wallet).toMatchObject({
      canBook: false,
      shortfall: 1000,
    });
  });

  it('stops polling at 60 seconds and when disabled', async () => {
    api.getWallet.mockResolvedValue({
      availableBalance: 1000,
      currency: 'NGN',
    });
    const { result, rerender } = renderHook(
      ({ enabled }) => useOrderGiglShipping({ enabled, orderId: 'order-1' }),
      { initialProps: { enabled: true }, wrapper }
    );
    await flushPromises();
    act(() => result.current.startTransferPoll());
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(api.getWallet).toHaveBeenCalledTimes(20);
    rerender({ enabled: false });
    await act(() => vi.advanceTimersByTimeAsync(6000));
    expect(api.getWallet).toHaveBeenCalledTimes(20);
  });

  it('does not overlap a slow wallet request with later ticks', async () => {
    const slow = deferred<{ availableBalance: number; currency: 'NGN' }>();
    api.getWallet.mockReturnValueOnce(slow.promise).mockResolvedValue({
      availableBalance: 1000,
      currency: 'NGN',
    });
    const { result } = renderHook(
      () => useOrderGiglShipping({ enabled: true, orderId: 'order-1' }),
      { wrapper }
    );
    await flushPromises();
    act(() => result.current.startTransferPoll());
    await act(() => vi.advanceTimersByTimeAsync(12_000));
    expect(api.getWallet).toHaveBeenCalledOnce();
    slow.resolve({ availableBalance: 1000, currency: 'NGN' });
    await flushPromises();
    await act(() => vi.advanceTimersByTimeAsync(3000));
    expect(api.getWallet).toHaveBeenCalledTimes(2);
  });
});
