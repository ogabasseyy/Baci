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
  type QuoteResult,
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

describe('useOrderGiglShipping polling lifecycle — generation and background', () => {
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

  it('ignores an old generation response after polling restarts', async () => {
    const old = deferred<{ availableBalance: number; currency: 'NGN' }>();
    api.getWallet.mockReturnValueOnce(old.promise).mockResolvedValue({
      availableBalance: 1000,
      currency: 'NGN',
    });
    const { result } = renderHook(
      () => useOrderGiglShipping({ enabled: true, orderId: 'order-1' }),
      { wrapper }
    );
    await flushPromises();
    act(() => result.current.startTransferPoll());
    await act(() => vi.advanceTimersByTimeAsync(3000));
    act(() => result.current.startTransferPoll());
    old.resolve({ availableBalance: 11000, currency: 'NGN' });
    await flushPromises();
    expect(api.getQuote).toHaveBeenCalledOnce();
    expect(result.current.wallet?.availableBalance).toBe(1000);
    await act(() => vi.advanceTimersByTimeAsync(3000));
    expect(api.getWallet).toHaveBeenCalledTimes(2);
  });

  it('ignores an in-flight sufficient response after app backgrounding', async () => {
    const pending = deferred<{ availableBalance: number; currency: 'NGN' }>();
    api.getWallet.mockReturnValue(pending.promise);
    const { result } = renderHook(
      () => useOrderGiglShipping({ enabled: true, orderId: 'order-1' }),
      { wrapper }
    );
    await flushPromises();
    act(() => result.current.startTransferPoll());
    await act(() => vi.advanceTimersByTimeAsync(3000));
    act(() => appState.listener('background'));
    pending.resolve({ availableBalance: 11000, currency: 'NGN' });
    await flushPromises();
    expect(api.getQuote).toHaveBeenCalledOnce();
    expect(result.current.wallet).toMatchObject({
      availableBalance: 1000,
      canBook: false,
    });
  });

  it('clears the polling state when backgrounding interrupts wallet polling', async () => {
    api.getWallet.mockResolvedValue({
      availableBalance: 1000,
      currency: 'NGN',
    });
    const { result } = renderHook(
      () => useOrderGiglShipping({ enabled: true, orderId: 'order-1' }),
      { wrapper }
    );
    await flushPromises();

    act(() => result.current.startTransferPoll());
    expect(result.current.state).toBe('polling');
    act(() => appState.listener('background'));
    expect(result.current.state).toBe('ready');
    act(() => appState.listener('active'));
  });

  it('ignores an in-flight replacement quote after app backgrounding', async () => {
    const replacement = deferred<QuoteResult>();
    api.getQuote
      .mockResolvedValueOnce(quoteResult)
      .mockReturnValueOnce(replacement.promise);
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
    expect(api.getQuote).toHaveBeenCalledTimes(2);
    act(() => appState.listener('background'));
    replacement.resolve({
      ...quoteResult,
      quote: { ...quoteResult.quote, price: 12000 },
      availableBalance: 11000,
      shortfall: 1000,
    });
    await flushPromises();
    expect(result.current.quote?.price).toBe(11000);
    expect(result.current.wallet?.canBook).toBe(false);
  });
});
