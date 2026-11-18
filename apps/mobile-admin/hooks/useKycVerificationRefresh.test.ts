// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/store-readiness-query', () => ({
  storeReadinessKeys: {
    detail: (merchantId: string) =>
      ['store-readiness', 'mobile', merchantId] as const,
  },
}));

import { useKycVerificationRefresh } from './useKycVerificationRefresh';

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  function Wrapper({ children }: { children: ReactNode }) {
    return createElement(
      QueryClientProvider,
      { client: queryClient },
      children
    );
  }

  return { queryClient, Wrapper };
}

describe('useKycVerificationRefresh', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('refreshes the merchant, readiness, and verification status queries', async () => {
    const { queryClient, Wrapper } = createWrapper();
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');
    const refetchVerificationStatus = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(
      () =>
        useKycVerificationRefresh({
          merchantId: 'merchant-1',
          refetchVerificationStatus,
        }),
      { wrapper: Wrapper }
    );

    await act(async () => {
      await result.current.refreshAfterVerification();
    });

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['merchant'] });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['store-readiness', 'mobile', 'merchant-1'],
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['verification-status', 'merchant-1'],
    });
    expect(refetchVerificationStatus).toHaveBeenCalledTimes(1);
  });

  it('invalidates readiness concurrently with merchant and verification status', async () => {
    const { queryClient, Wrapper } = createWrapper();
    const events: string[] = [];
    let resolveMerchant: (() => void) | undefined;
    const merchantInvalidation = new Promise<void>((resolve) => {
      resolveMerchant = resolve;
    });

    const invalidateQueries = vi
      .spyOn(queryClient, 'invalidateQueries')
      .mockImplementation((filters) => {
        const key = Array.isArray(filters?.queryKey)
          ? String(filters?.queryKey[0])
          : 'unknown';
        events.push(`invalidate:${key}`);
        if (key === 'merchant') {
          return merchantInvalidation;
        }
        return Promise.resolve();
      });

    const refetchVerificationStatus = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(
      () =>
        useKycVerificationRefresh({
          merchantId: 'merchant-1',
          refetchVerificationStatus,
        }),
      { wrapper: Wrapper }
    );

    await act(async () => {
      const refreshPromise = result.current.refreshAfterVerification();
      // All cache invalidations begin together; none depends on merchant first.
      await Promise.resolve();
      expect(events).toHaveLength(3);
      expect(events).toEqual(
        expect.arrayContaining([
          'invalidate:merchant',
          'invalidate:verification-status',
          'invalidate:store-readiness',
        ])
      );
      resolveMerchant?.();
      await refreshPromise;
    });

    expect(invalidateQueries).toHaveBeenCalledTimes(3);
  });

  it('rejects without issuing broad invalidations when merchant id is missing', async () => {
    const { queryClient, Wrapper } = createWrapper();
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');
    const refetchVerificationStatus = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(
      () =>
        useKycVerificationRefresh({
          merchantId: '',
          refetchVerificationStatus,
        }),
      { wrapper: Wrapper }
    );

    await expect(result.current.refreshAfterVerification()).rejects.toThrow(
      'Merchant ID is required to refresh verification'
    );

    expect(invalidateQueries).not.toHaveBeenCalled();
    expect(refetchVerificationStatus).not.toHaveBeenCalled();
  });

  it('rejects without issuing broad invalidations when merchant id is null during initial loading', async () => {
    const { queryClient, Wrapper } = createWrapper();
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');
    const refetchVerificationStatus = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(
      () =>
        useKycVerificationRefresh({
          merchantId: null,
          refetchVerificationStatus,
        }),
      { wrapper: Wrapper }
    );

    await expect(result.current.refreshAfterVerification()).rejects.toThrow(
      'Merchant ID is required to refresh verification'
    );

    expect(invalidateQueries).not.toHaveBeenCalled();
    expect(refetchVerificationStatus).not.toHaveBeenCalled();
  });

  it('refetches authoritative verification status when readiness refresh fails', async () => {
    const { queryClient, Wrapper } = createWrapper();
    vi.spyOn(queryClient, 'invalidateQueries').mockImplementation((filters) => {
      if (filters?.queryKey?.[0] === 'store-readiness') {
        return Promise.reject(new Error('Readiness refresh failed'));
      }
      return Promise.resolve();
    });
    const refetchVerificationStatus = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(
      () =>
        useKycVerificationRefresh({
          merchantId: 'merchant-1',
          refetchVerificationStatus,
        }),
      { wrapper: Wrapper }
    );

    await expect(
      result.current.refreshAfterVerification()
    ).resolves.toBeUndefined();

    expect(refetchVerificationStatus).toHaveBeenCalledTimes(1);
  });
});
