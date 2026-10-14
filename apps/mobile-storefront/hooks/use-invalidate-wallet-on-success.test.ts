import { jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react-native';
import { createElement, type ReactNode } from 'react';
import { walletKeys } from '@/hooks/use-wallet';
import { useInvalidateWalletOnSuccess } from './use-invalidate-wallet-on-success';

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(
      QueryClientProvider,
      { client: queryClient },
      children
    );
  };
}

function createClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

const input = {
  activeMerchantId: 'merchant-1',
  currentType: 'airtime',
  successReference: 'REF-1',
  walletOwnerId: 'owner-1',
};

describe('useInvalidateWalletOnSuccess', () => {
  it('invalidates the wallet prefix and root on success', () => {
    // Codex R63 6ruGlt: colocated coverage for the R60 extraction.
    // R77 6sNGPB adds the root (second call) for the pre-hydration
    // user-owner generation.
    const queryClient = createClient();
    const spy = jest.spyOn(queryClient, 'invalidateQueries');

    renderHook(() => useInvalidateWalletOnSuccess(input), {
      wrapper: createWrapper(queryClient),
    });

    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenNthCalledWith(1, {
      queryKey: walletKeys.data({
        merchantId: 'merchant-1',
        ownerId: 'owner-1',
      }),
      exact: false,
    });
    expect(spy).toHaveBeenNthCalledWith(2, {
      queryKey: walletKeys.all,
      exact: false,
    });
  });

  it('invalidates the pre-hydration user-owner generation after success', () => {
    // Codex R77 6sNGPB: submit cached the balance under the auth-user
    // owner, then the customer row arrived before success — the
    // user-owner query must not keep serving the pre-debit balance
    // as fresh into the next customer-null state.
    const queryClient = createClient();
    const userOwnerKey = walletKeys.data({
      merchantId: 'merchant-1',
      ownerId: 'user-1',
    });
    queryClient.setQueryData(userOwnerKey, {
      wallet: { balance: 5000 },
      transactions: [],
    });

    renderHook(
      () =>
        useInvalidateWalletOnSuccess({ ...input, walletOwnerId: 'customer-1' }),
      { wrapper: createWrapper(queryClient) }
    );

    expect(queryClient.getQueryState(userOwnerKey)?.isInvalidated).toBe(true);
  });

  it('stays idle without a type, reference, or owner', () => {
    const queryClient = createClient();
    const spy = jest.spyOn(queryClient, 'invalidateQueries');

    const { unmount: unmountTypeless } = renderHook(
      () => useInvalidateWalletOnSuccess({ ...input, currentType: null }),
      { wrapper: createWrapper(queryClient) }
    );
    const { unmount: unmountReferenceless } = renderHook(
      () => useInvalidateWalletOnSuccess({ ...input, successReference: null }),
      { wrapper: createWrapper(queryClient) }
    );
    const { unmount: unmountOwnerless } = renderHook(
      () => useInvalidateWalletOnSuccess({ ...input, walletOwnerId: null }),
      { wrapper: createWrapper(queryClient) }
    );

    expect(spy).not.toHaveBeenCalled();
    unmountTypeless();
    unmountReferenceless();
    unmountOwnerless();
  });
});
