import { describe, expect, it, jest } from '@jest/globals';
import { QueryObserver } from '@tanstack/query-core';
import { QueryClient } from '@tanstack/react-query';
import { clearQueryCachePreservingObservers } from './query-cache-observer-safety';

async function flushMicrotasks() {
  for (let index = 0; index < 5; index += 1) {
    await Promise.resolve();
  }
}

describe('clearQueryCachePreservingObservers', () => {
  it('restarts an active query instead of orphaning it during logout', async () => {
    // Arrange: the first request is still pending when the cache is cleared.
    let resolveFirstRequest: ((value: string) => void) | undefined;
    const queryFn = jest.fn(() => {
      if (queryFn.mock.calls.length === 1) {
        return new Promise<string>((resolve) => {
          resolveFirstRequest = resolve;
        });
      }
      return Promise.resolve('fresh guest content');
    });
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: Number.POSITIVE_INFINITY },
      },
    });
    queryClient.setQueryData(['private'], 'stale account data');
    const observer = new QueryObserver(queryClient, {
      queryKey: ['public-home'],
      queryFn,
    });
    const unsubscribe = observer.subscribe(() => undefined);
    await flushMicrotasks();

    // Act: this is the state reached when sign-out clears the cache mid-fetch.
    clearQueryCachePreservingObservers(queryClient);
    await flushMicrotasks();

    // Assert: active observers remain connected and refetch; inactive data is gone.
    expect(queryFn).toHaveBeenCalledTimes(2);
    expect(observer.getCurrentResult().data).toBe('fresh guest content');
    expect(queryClient.getQueryData(['private'])).toBeUndefined();

    resolveFirstRequest?.('stale account data');
    unsubscribe();
    queryClient.clear();
  });

  it('surfaces a rejected guest refetch while removing inactive account data', async () => {
    // Arrange: the second invocation is the refetch performed after logout.
    let resolveFirstRequest: ((value: string) => void) | undefined;
    const queryFn = jest.fn(() => {
      if (queryFn.mock.calls.length === 1) {
        return new Promise<string>((resolve) => {
          resolveFirstRequest = resolve;
        });
      }
      return Promise.reject(new Error('guest request failed'));
    });
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: Number.POSITIVE_INFINITY },
      },
    });
    queryClient.setQueryData(['private'], 'stale account data');
    const observer = new QueryObserver(queryClient, {
      queryKey: ['public-home'],
      queryFn,
    });
    const unsubscribe = observer.subscribe(() => undefined);
    await flushMicrotasks();

    // Act
    clearQueryCachePreservingObservers(queryClient);
    await flushMicrotasks();

    // Assert
    expect(queryFn).toHaveBeenCalledTimes(2);
    expect(observer.getCurrentResult().isError).toBe(true);
    expect(queryClient.getQueryData(['private'])).toBeUndefined();

    resolveFirstRequest?.('stale account data');
    unsubscribe();
    queryClient.clear();
  });

  it('does not refetch mounted account queries during an identity transition', async () => {
    // Arrange
    let resolveAccountRequest: ((value: string) => void) | undefined;
    const accountQueryFn = jest.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveAccountRequest = resolve;
        })
    );
    const publicQueryFn = jest.fn(() => Promise.resolve('public data'));
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: Number.POSITIVE_INFINITY },
      },
    });
    const accountObserver = new QueryObserver(queryClient, {
      queryKey: ['wallet', 'user-a'],
      queryFn: accountQueryFn,
    });
    const publicObserver = new QueryObserver(queryClient, {
      queryKey: ['public-home'],
      queryFn: publicQueryFn,
    });
    const unsubscribeAccount = accountObserver.subscribe(() => undefined);
    const unsubscribePublic = publicObserver.subscribe(() => undefined);
    await flushMicrotasks();

    // Act
    clearQueryCachePreservingObservers(queryClient);
    await flushMicrotasks();

    // Assert
    expect(accountQueryFn).toHaveBeenCalledTimes(1);
    expect(accountObserver.getCurrentResult().data).toBeUndefined();
    expect(publicQueryFn).toHaveBeenCalledTimes(2);
    expect(publicObserver.getCurrentResult().data).toBe('public data');

    resolveAccountRequest?.('late account data');
    await flushMicrotasks();
    expect(accountObserver.getCurrentResult().data).toBeUndefined();

    unsubscribeAccount();
    unsubscribePublic();
    queryClient.clear();
  });

  it('refetches mounted account queries for an explicit cache clear', async () => {
    // Arrange
    const queryFn = jest
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce('account data')
      .mockResolvedValueOnce('fresh account data');
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: Number.POSITIVE_INFINITY },
      },
    });
    const observer = new QueryObserver(queryClient, {
      queryKey: ['wallet', 'user-a'],
      queryFn,
    });
    const unsubscribe = observer.subscribe(() => undefined);
    await flushMicrotasks();

    // Act
    clearQueryCachePreservingObservers(queryClient, {
      refetchAccountQueries: true,
    });
    await flushMicrotasks();

    // Assert
    expect(queryFn).toHaveBeenCalledTimes(2);
    expect(observer.getCurrentResult().data).toBe('fresh account data');

    unsubscribe();
    queryClient.clear();
  });

  it('refetches public VTU billers while clearing saved cards', async () => {
    // Arrange
    const billersFn = jest
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce('billers')
      .mockResolvedValueOnce('fresh billers');
    const cardsFn = jest.fn<() => Promise<string>>().mockResolvedValue('cards');
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: Number.POSITIVE_INFINITY },
      },
    });
    const billersObserver = new QueryObserver(queryClient, {
      queryKey: ['vtu', 'billers', 'airtime'],
      queryFn: billersFn,
    });
    const cardsObserver = new QueryObserver(queryClient, {
      queryKey: ['vtu-saved-cards', 'user-a'],
      queryFn: cardsFn,
    });
    const unsubscribeBillers = billersObserver.subscribe(() => undefined);
    const unsubscribeCards = cardsObserver.subscribe(() => undefined);
    await flushMicrotasks();

    // Act
    clearQueryCachePreservingObservers(queryClient);
    await flushMicrotasks();

    // Assert
    expect(billersFn).toHaveBeenCalledTimes(2);
    expect(cardsFn).toHaveBeenCalledTimes(1);
    expect(billersObserver.getCurrentResult().data).toBe('fresh billers');
    expect(cardsObserver.getCurrentResult().data).toBeUndefined();

    unsubscribeBillers();
    unsubscribeCards();
    queryClient.clear();
  });
});
