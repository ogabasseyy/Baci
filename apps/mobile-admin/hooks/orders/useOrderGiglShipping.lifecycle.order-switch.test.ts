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

describe('useOrderGiglShipping polling lifecycle — disable and order switch', () => {
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

  it('ignores in-flight responses after disable and unmount', async () => {
    const disabled = deferred<{ availableBalance: number; currency: 'NGN' }>();
    const unmounted = deferred<{ availableBalance: number; currency: 'NGN' }>();
    api.getWallet
      .mockReturnValueOnce(disabled.promise)
      .mockReturnValueOnce(unmounted.promise);
    const first = renderHook(
      ({ enabled }) => useOrderGiglShipping({ enabled, orderId: 'order-1' }),
      { initialProps: { enabled: true }, wrapper }
    );
    await flushPromises();
    act(() => first.result.current.startTransferPoll());
    await act(() => vi.advanceTimersByTimeAsync(3000));
    first.rerender({ enabled: false });
    disabled.resolve({ availableBalance: 11000, currency: 'NGN' });
    await flushPromises();
    expect(api.getQuote).toHaveBeenCalledOnce();
    expect(first.result.current.wallet?.canBook).toBe(false);

    const second = renderHook(
      () => useOrderGiglShipping({ enabled: true, orderId: 'order-2' }),
      { wrapper }
    );
    await flushPromises();
    act(() => second.result.current.startTransferPoll());
    await act(() => vi.advanceTimersByTimeAsync(3000));
    second.unmount();
    unmounted.resolve({ availableBalance: 11000, currency: 'NGN' });
    await flushPromises();
    expect(api.getQuote).toHaveBeenCalledTimes(2);
  });

  it('restarts an aborted quote load after the app returns to the foreground', async () => {
    const pending = deferred<QuoteResult>();
    const activeQuote = {
      ...quoteResult,
      quote: { ...quoteResult.quote, price: 12000 },
    };
    api.getQuote
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(activeQuote);
    const { result } = renderHook(
      () => useOrderGiglShipping({ enabled: true, orderId: 'order-1' }),
      { wrapper }
    );
    await flushPromises();
    expect(result.current.state).toBe('loading');

    act(() => appState.listener('background'));
    expect(result.current.state).toBe('ready');
    act(() => appState.listener('active'));
    await flushPromises();

    expect(api.getQuote).toHaveBeenCalledTimes(2);
    expect(result.current.state).toBe('ready');
    expect(result.current.quote?.price).toBe(12000);
    pending.resolve({
      ...quoteResult,
      quote: { ...quoteResult.quote, price: 9000 },
    });
    await flushPromises();
    expect(result.current.quote?.price).toBe(12000);
  });

  it('ignores an old funding rejection after switching orders and starting a new request', async () => {
    const oldRequest = deferred<{ account: null; status: 'pending' }>();
    const currentRequest = deferred<{ account: null; status: 'pending' }>();
    api.getOrRequestFunding
      .mockReturnValueOnce(oldRequest.promise)
      .mockReturnValueOnce(currentRequest.promise);
    const { result, rerender } = renderHook(
      ({ orderId }) => useOrderGiglShipping({ enabled: true, orderId }),
      { initialProps: { orderId: 'order-1' }, wrapper }
    );
    await flushPromises();

    let oldFunding!: Promise<void>;
    act(() => {
      oldFunding = result.current.startFunding();
    });
    rerender({ orderId: 'order-2' });
    await flushPromises();
    let currentFunding!: Promise<void>;
    act(() => {
      currentFunding = result.current.startFunding();
    });
    expect(api.getOrRequestFunding).toHaveBeenCalledTimes(2);
    expect(result.current.state).toBe('funding');

    oldRequest.reject(new Error('old order funding failed'));
    await flushPromises();
    expect(result.current.state).toBe('funding');
    expect(result.current.error).toBeNull();

    currentRequest.resolve({ account: null, status: 'pending' });
    await act(async () => {
      await Promise.all([oldFunding, currentFunding]);
    });
    expect(result.current.state).toBe('funding_pending');
  });

  it('clears order-scoped quote, wallet, and funding state before a new order loads', async () => {
    const replacement = deferred<QuoteResult>();
    api.getQuote.mockResolvedValueOnce({
      ...quoteResult,
      availableBalance: 11000,
      shortfall: 0,
      canBook: true,
    });
    api.getQuote.mockReturnValueOnce(replacement.promise);
    const { result, rerender } = renderHook(
      ({ orderId }) => useOrderGiglShipping({ enabled: true, orderId }),
      { initialProps: { orderId: 'order-1' }, wrapper }
    );
    await flushPromises();
    expect(result.current.quote).not.toBeNull();
    expect(result.current.wallet?.canBook).toBe(true);

    rerender({ orderId: 'order-2' });

    expect(result.current.quote).toBeNull();
    expect(result.current.wallet).toBeNull();
    expect(result.current.fundingAccount).toBeNull();
    replacement.resolve(quoteResult);
    await flushPromises();
  });

  it('uses the current order when resuming after switching orders', async () => {
    const replacement = deferred<QuoteResult>();
    const resumed = deferred<QuoteResult>();
    api.getQuote
      .mockResolvedValueOnce(quoteResult)
      .mockReturnValueOnce(replacement.promise)
      .mockReturnValueOnce(resumed.promise);
    const { result, rerender } = renderHook(
      ({ orderId }) => useOrderGiglShipping({ enabled: true, orderId }),
      { initialProps: { orderId: 'order-1' }, wrapper }
    );
    await flushPromises();

    rerender({ orderId: 'order-2' });
    act(() => appState.listener('background'));
    act(() => appState.listener('active'));

    expect(api.getQuote).toHaveBeenCalledTimes(3);
    expect(api.getQuote.mock.calls[1]?.[0]).toBe('order-2');
    expect(api.getQuote.mock.calls[2]?.[0]).toBe('order-2');

    replacement.resolve(quoteResult);
    resumed.resolve({
      ...quoteResult,
      quote: { ...quoteResult.quote, price: 12000 },
    });
    await flushPromises();
    expect(result.current.quote?.price).toBe(12000);
  });
});
