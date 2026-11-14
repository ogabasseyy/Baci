import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import {
  useRefreshWalletActivity,
  WALLET_ACTIVITY_QUERY_KEY,
} from './use-refresh-wallet-activity';

describe('bugfix: a paid check or bill was missing from the wallet activity until a pull to refresh (Fable walk 17)', () => {
  it('marks every wallet activity list stale, so the next open reads the server', () => {
    const client = new QueryClient();
    const key = [...WALLET_ACTIVITY_QUERY_KEY, 'merchant-1', 'user-1'];
    client.setQueryData(key, { pages: [] });
    const other = ['orders', 'merchant-1'];
    client.setQueryData(other, 'kept');
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useRefreshWalletActivity(), {
      wrapper,
    });

    result.current();

    expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    expect(client.getQueryState(other)?.isInvalidated).toBe(false);
  });

  it('does nothing, never throws, without a query provider', () => {
    const { result } = renderHook(() => useRefreshWalletActivity());
    expect(() => result.current()).not.toThrow();
  });
});
