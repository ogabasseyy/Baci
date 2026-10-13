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
  it('invalidates the wallet prefix on success', () => {
    // Codex R63 6ruGlt: colocated coverage for the R60 extraction.
    const queryClient = createClient();
    const spy = jest.spyOn(queryClient, 'invalidateQueries');

    renderHook(() => useInvalidateWalletOnSuccess(input), {
      wrapper: createWrapper(queryClient),
    });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({
      queryKey: walletKeys.data({
        merchantId: 'merchant-1',
        ownerId: 'owner-1',
      }),
      exact: false,
    });
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
