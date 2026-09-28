import { describe, expect, it, jest } from '@jest/globals';
import {
  fetchLockedNextPage,
  type NextPageLocks,
} from './product-next-page-lock';

function hangingFetch() {
  let resolveFetch: (() => void) | undefined;
  const promise = new Promise<string>((resolve) => {
    resolveFetch = () => resolve('page');
  });
  const fetchNextPage = jest.fn(() => promise);
  return {
    fetchNextPage,
    resolveFetch: () => resolveFetch?.(),
  };
}

describe('fetchLockedNextPage', () => {
  it('starts one fetch for synchronous duplicate acquisitions', async () => {
    const locks: NextPageLocks = new Map();
    const { fetchNextPage, resolveFetch } = hangingFetch();

    fetchLockedNextPage(locks, 'query-a', fetchNextPage);
    fetchLockedNextPage(locks, 'query-a', fetchNextPage);

    expect(fetchNextPage).toHaveBeenCalledTimes(1);

    resolveFetch();
    await Promise.resolve();
    await Promise.resolve();
    expect(locks.size).toBe(0);
  });

  it('tracks in-flight requests independently per query key', () => {
    const locks: NextPageLocks = new Map();
    const queryA = hangingFetch();
    const queryB = hangingFetch();

    fetchLockedNextPage(locks, 'query-a', queryA.fetchNextPage);
    fetchLockedNextPage(locks, 'query-b', queryB.fetchNextPage);

    expect(queryA.fetchNextPage).toHaveBeenCalledTimes(1);
    expect(queryB.fetchNextPage).toHaveBeenCalledTimes(1);

    queryA.resolveFetch();
    queryB.resolveFetch();
  });

  it('keeps the earlier lock when the shopper returns before either settles', async () => {
    const locks: NextPageLocks = new Map();
    const queryA = hangingFetch();
    const queryB = hangingFetch();

    // A starts loading, the shopper moves to B which also starts loading,
    // then returns to A while both are unresolved.
    fetchLockedNextPage(locks, 'query-a', queryA.fetchNextPage);
    fetchLockedNextPage(locks, 'query-b', queryB.fetchNextPage);
    fetchLockedNextPage(locks, 'query-a', queryA.fetchNextPage);

    // A's original request is still running: no duplicate A offset fetch.
    expect(queryA.fetchNextPage).toHaveBeenCalledTimes(1);
    expect(queryB.fetchNextPage).toHaveBeenCalledTimes(1);

    // Each settlement releases only its own entry.
    queryA.resolveFetch();
    await Promise.resolve();
    await Promise.resolve();
    expect(locks.get('query-a')).toBeUndefined();
    expect(locks.get('query-b')).toBe(true);

    queryB.resolveFetch();
    await Promise.resolve();
    await Promise.resolve();
    expect(locks.size).toBe(0);
  });

  it('releases the lock when the fetch fails', async () => {
    const locks: NextPageLocks = new Map();
    const failingFetch = jest.fn(() =>
      Promise.reject(new Error('network down'))
    );

    fetchLockedNextPage(locks, 'query-a', failingFetch);
    await Promise.resolve();
    await Promise.resolve();

    expect(locks.size).toBe(0);

    const retry = hangingFetch();
    fetchLockedNextPage(locks, 'query-a', retry.fetchNextPage);
    expect(retry.fetchNextPage).toHaveBeenCalledTimes(1);
    retry.resolveFetch();
  });
});
