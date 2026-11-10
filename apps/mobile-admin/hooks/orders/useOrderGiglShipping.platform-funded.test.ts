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
import { quoteResult } from './useOrderGiglShipping.lifecycle.test-support';

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

describe('bugfix: Baci-paid quotes and balance refresh', () => {
  beforeEach(() => {
    for (const mock of Object.values(api)) mock.mockReset();
    api.getFundingAccount.mockResolvedValue(null);
    api.getOrRequestFunding.mockResolvedValue({
      account: null,
      status: 'pending',
    });
    appState.listener = () => undefined;
  });

  const platformQuote = {
    ...quoteResult,
    availableBalance: 0,
    shortfall: 0,
    canBook: true,
    paidByBaci: true,
  };

  it('re-resolves the quote instead of reading the wallet summary', async () => {
    api.getQuote.mockResolvedValue(platformQuote);
    const { result } = renderHook(
      () => useOrderGiglShipping({ enabled: true, orderId: 'order-1' }),
      { wrapper }
    );
    await flushPromises();
    expect(result.current.wallet?.paidByBaci).toBe(true);
    await act(async () => {
      await result.current.refreshBalance();
    });
    expect(api.getWallet).not.toHaveBeenCalled();
    expect(api.getQuote).toHaveBeenCalledTimes(2);
  });

  it('replaces the Baci-paid state when the flag was revoked', async () => {
    api.getQuote
      .mockResolvedValueOnce(platformQuote)
      .mockResolvedValueOnce(quoteResult);
    const { result } = renderHook(
      () => useOrderGiglShipping({ enabled: true, orderId: 'order-1' }),
      { wrapper }
    );
    await flushPromises();
    await act(async () => {
      await result.current.refreshBalance();
    });
    expect(result.current.wallet?.paidByBaci).toBeUndefined();
    expect(result.current.wallet?.canBook).toBe(false);
  });
});
