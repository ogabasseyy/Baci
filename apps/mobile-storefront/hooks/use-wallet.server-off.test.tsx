import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { createElement, type PropsWithChildren } from 'react';
import { useAuthStore } from '@/stores/auth-store';
import {
  SERVER_OFF_MERCHANT_ID,
  serverOffError,
} from '@/test-support/piggyvest-server-off.test-support';
import { useWallet } from './use-wallet';
import { fetchWalletDataUnbounded } from './wallet-data';

jest.mock('./wallet-data');
jest.mock('@/lib/supabase', () => {
  const channel: Record<string, jest.Mock> = {};
  channel.on = jest.fn(() => channel);
  channel.subscribe = jest.fn();
  return {
    supabase: {
      channel: jest.fn(() => channel),
      removeChannel: jest.fn(),
    },
  };
});

describe('server keeps PiggyVest off', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    act(() => {
      useAuthStore.setState({
        user: { id: 'user-a' } as never,
        customer: null,
        merchantId: SERVER_OFF_MERCHANT_ID,
      });
    });
  });

  it('exposes dataUpdatedAt and stays usable when the wallet read fails PIGGYVEST_NOT_READY', async () => {
    jest.mocked(fetchWalletDataUnbounded).mockRejectedValue(serverOffError());
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = ({ children }: PropsWithChildren) =>
      createElement(QueryClientProvider, { client }, children);
    const { result } = renderHook(() => useWallet(), { wrapper });
    expect(typeof result.current.dataUpdatedAt).toBe('number');
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.dataUpdatedAt).toBe(0);
    expect(result.current.data).toBeUndefined();
  });
});
