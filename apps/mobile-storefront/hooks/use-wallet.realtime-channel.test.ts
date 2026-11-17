import { describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react-native';
import { createElement, type PropsWithChildren } from 'react';

type Chain = Record<string, unknown> & PromiseLike<unknown>;

jest.mock('@/lib/supabase', () => {
  const chain = (): Chain => {
    const result = Promise.resolve({ data: null, error: null });
    const proxy: Chain = new Proxy({} as Chain, {
      get: (_target, key) =>
        key === 'then' ? result.then.bind(result) : () => proxy,
    });
    return proxy;
  };
  return {
    supabase: {
      channel: jest.fn(() => {
        const channel = {
          on: jest.fn(() => channel),
          subscribe: jest.fn(),
        };
        return channel;
      }),
      from: () => chain(),
      removeChannel: jest.fn(),
      rpc: () => chain(),
    },
  };
});

jest.mock('./resolve-wallet-funding-account', () => {
  const actual = jest.requireActual(
    './resolve-wallet-funding-account'
  ) as typeof import('./resolve-wallet-funding-account');
  return { ...actual, readPrimaryFundingAccount: async () => null };
});

jest.mock('@/lib/config', () => ({
  CONFIG: { MERCHANT_ID: 'configured-merchant', MERCHANT_SLUG: 'ogabassey' },
}));

jest.mock('@/services/analytics', () => ({ trackEvent: jest.fn() }));

jest.mock('@/stores/auth-store', () => {
  const { create } = require('zustand');
  return {
    useAuthStore: create(() => ({
      customer: { id: 'customer-1', email: 'customer@example.com' },
      merchantId: 'merchant-1',
      user: { id: 'user-1' },
    })),
  };
});

import { useWallet } from '@/hooks/use-wallet';
import { supabase } from '@/lib/supabase';

function wrapper({ children }: PropsWithChildren) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return createElement(QueryClientProvider, { client }, children);
}

describe('useWallet realtime channel', () => {
  it('bugfix: gives wallet hooks mounted in the same millisecond their own realtime channels', async () => {
    // The utilities screen mounts useWallet twice at once. Supabase hands back
    // the already-subscribed channel for a repeated name, and adding listeners
    // to it throws, which crashed the airtime screen on open.
    const channel = jest.mocked(supabase.channel);
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_794_935_225_811);

    const { unmount } = renderHook(
      () => ({ first: useWallet(), second: useWallet() }),
      { wrapper }
    );

    await waitFor(() => expect(channel.mock.calls.length).toBeGreaterThan(1));
    const names = channel.mock.calls.map((call) => call[0]);
    expect(new Set(names).size).toBe(names.length);

    nowSpy.mockRestore();
    unmount();
  });
});
