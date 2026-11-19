// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStorePublish } from './useStorePublish';

const { mockApiClient, mockInvalidateStoreReadiness, TestNetworkError } =
  vi.hoisted(() => {
    class TestNetworkError extends Error {
      public readonly isTimeout: boolean;
      public readonly isOffline: boolean;
      public readonly statusCode?: number;
      public readonly data?: unknown;

      constructor(
        message: string,
        options: {
          isTimeout?: boolean;
          isOffline?: boolean;
          statusCode?: number;
          data?: unknown;
        } = {}
      ) {
        super(message);
        this.name = 'NetworkError';
        this.isTimeout = options.isTimeout ?? false;
        this.isOffline = options.isOffline ?? false;
        this.statusCode = options.statusCode;
        this.data = options.data;
      }
    }
    return {
      mockApiClient: vi.fn(),
      mockInvalidateStoreReadiness: vi.fn().mockResolvedValue(undefined),
      TestNetworkError,
    };
  });

vi.mock('@/lib/api-client', () => ({
  NetworkError: TestNetworkError,
  apiClient: (...args: unknown[]) => mockApiClient(...args),
}));

vi.mock('@/lib/invalidate-store-readiness', () => ({
  invalidateStoreReadiness: mockInvalidateStoreReadiness,
}));

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

describe('useStorePublish', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInvalidateStoreReadiness.mockResolvedValue(undefined);
  });

  it('publishes the captured merchant and invalidates that merchant readiness data', async () => {
    const { queryClient, Wrapper } = createWrapper();
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');
    const onPublished = vi.fn().mockResolvedValue(undefined);

    mockApiClient.mockResolvedValueOnce({ success: true });

    const { result } = renderHook(
      () =>
        useStorePublish({
          merchantId: 'merchant-1',
          onPublished,
        }),
      { wrapper: Wrapper }
    );

    await act(async () => {
      await result.current.publishStore();
    });

    expect(mockApiClient).toHaveBeenCalledWith('/api/merchant/publish', {
      method: 'POST',
      body: JSON.stringify({ merchantId: 'merchant-1' }),
    });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['merchant'] });
    expect(mockInvalidateStoreReadiness).toHaveBeenCalledWith(
      queryClient,
      'merchant-1'
    );
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['merchant-payout'],
    });
    expect(onPublished).toHaveBeenCalledTimes(1);
    expect(result.current.isPublishing).toBe(false);
  });

  it('fails fast when merchant context is missing', async () => {
    const { Wrapper } = createWrapper();

    const { result } = renderHook(() => useStorePublish({ merchantId: null }), {
      wrapper: Wrapper,
    });

    let thrownError: unknown = null;

    await act(async () => {
      try {
        await result.current.publishStore();
      } catch (error) {
        thrownError = error;
      }
    });

    expect(thrownError).toBeInstanceOf(Error);
    expect((thrownError as Error).message).toBe(
      'Merchant not loaded. Please try again.'
    );
    expect(mockApiClient).not.toHaveBeenCalled();
    expect(result.current.isPublishing).toBe(false);
  });

  it('starts every post-publish refresh together and waits before completing', async () => {
    const { queryClient, Wrapper } = createWrapper();
    const releases: Array<() => void> = [];
    const deferred = () =>
      new Promise<void>((resolve) => releases.push(resolve));
    vi.spyOn(queryClient, 'invalidateQueries').mockImplementation(deferred);
    mockInvalidateStoreReadiness.mockImplementation(deferred);
    mockApiClient.mockResolvedValueOnce({ success: true });
    const { result } = renderHook(
      () => useStorePublish({ merchantId: 'merchant-1' }),
      { wrapper: Wrapper }
    );

    let completed = false;
    let publish!: Promise<void>;
    act(() => {
      publish = result.current.publishStore().then(() => {
        completed = true;
      });
    });
    await vi.waitFor(() => expect(releases).toHaveLength(3));
    expect(completed).toBe(false);
    await act(async () => {
      for (const release of releases) release();
      await publish;
    });
    expect(completed).toBe(true);
  });

  it('preserves publish success when only readiness invalidation fails', async () => {
    const { queryClient, Wrapper } = createWrapper();
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');
    const onPublished = vi.fn().mockResolvedValue(undefined);
    mockApiClient.mockResolvedValueOnce({ success: true });
    mockInvalidateStoreReadiness.mockRejectedValueOnce(
      new Error('Readiness refresh failed')
    );
    const { result } = renderHook(
      () => useStorePublish({ merchantId: 'merchant-1', onPublished }),
      { wrapper: Wrapper }
    );

    await act(async () => {
      await expect(result.current.publishStore()).resolves.toEqual({
        status: 'published',
      });
    });

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['merchant'] });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['merchant-payout'],
    });
    expect(onPublished).toHaveBeenCalledTimes(1);
  });

  it('surfaces validation errors with missingItems when apiClient throws NetworkError', async () => {
    const { queryClient, Wrapper } = createWrapper();
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');
    const onPublished = vi.fn().mockResolvedValue(undefined);

    mockApiClient.mockRejectedValueOnce(
      new TestNetworkError('Cannot publish store', {
        statusCode: 400,
        data: {
          error: 'Cannot publish store',
          message: 'Please complete the following required items:',
          missingItems: ['Bank account details', 'Contact information'],
        },
      })
    );

    const { result } = renderHook(
      () =>
        useStorePublish({
          merchantId: 'merchant-1',
          onPublished,
        }),
      { wrapper: Wrapper }
    );

    let thrownError: unknown = null;
    await act(async () => {
      try {
        await result.current.publishStore();
      } catch (error) {
        thrownError = error;
      }
    });

    expect(thrownError).toBeInstanceOf(Error);
    const message = (thrownError as Error).message;
    expect(message).toContain('Please complete the following required items');
    expect(message).toContain('- Bank account details');
    expect(message).toContain('- Contact information');
    expect(invalidateQueries).not.toHaveBeenCalled();
    expect(onPublished).not.toHaveBeenCalled();
    expect(result.current.isPublishing).toBe(false);
  });

  it('rethrows non-NetworkError failures unchanged', async () => {
    const { queryClient, Wrapper } = createWrapper();
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');
    const onPublished = vi.fn();

    const original = new Error('boom');
    mockApiClient.mockRejectedValueOnce(original);

    const { result } = renderHook(
      () =>
        useStorePublish({
          merchantId: 'merchant-1',
          onPublished,
        }),
      { wrapper: Wrapper }
    );

    let thrownError: unknown = null;
    await act(async () => {
      try {
        await result.current.publishStore();
      } catch (error) {
        thrownError = error;
      }
    });

    expect(thrownError).toBe(original);
    expect(invalidateQueries).not.toHaveBeenCalled();
    expect(onPublished).not.toHaveBeenCalled();
    expect(result.current.isPublishing).toBe(false);
  });
});
