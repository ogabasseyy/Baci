import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MerchantNotificationWithDetails } from '@/types/notifications';
import {
  type FetchNotificationsDeps,
  fetchNotificationsRequest,
} from './notification-requests';

function state<T>(initial: T) {
  let value = initial;
  const set = vi.fn((next: T | ((previous: T) => T)) => {
    value =
      typeof next === 'function' ? (next as (previous: T) => T)(value) : next;
  });
  return { get: () => value, set };
}

function notification(id: string) {
  return { id } as MerchantNotificationWithDetails;
}

function createDeps(cursor: string | null = null) {
  const loading = state(false);
  const notifications = state<MerchantNotificationWithDetails[]>([]);
  const unread = state(7);
  const hasMore = state(false);
  const nextCursor = state<string | null>(cursor);
  const error = state<string | null>(null);
  const deps: FetchNotificationsDeps = {
    cursor,
    isFetchingRef: { current: false },
    pendingRefreshRef: { current: false },
    setIsLoading: loading.set,
    setNotifications: notifications.set,
    setUnreadCount: unread.set,
    setHasMore: hasMore.set,
    setCursor: nextCursor.set,
    setError: error.set,
  };

  return {
    deps,
    error,
    hasMore,
    notifications,
    unread,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('fetchNotificationsRequest', () => {
  it('keeps an explicit error for a non-OK response', async () => {
    const { deps, error } = createDeps();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ error: 'unavailable' }),
      })
    );

    await fetchNotificationsRequest(false, deps);

    expect(error.get()).toBe(
      'Notifications could not be loaded. Please try again.'
    );
  });

  it('blocks concurrent append requests and deduplicates appended notification IDs', async () => {
    const { deps, notifications, unread } = createDeps('cursor-1');
    notifications.set([notification('existing')]);
    let resolveResponse: (response: Response) => void = () => undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveResponse = resolve;
          })
      )
    );

    const first = fetchNotificationsRequest(true, deps);
    const second = fetchNotificationsRequest(true, deps);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    resolveResponse({
      ok: true,
      json: async () => ({
        cursor: 'cursor-2',
        data: [notification('existing'), notification('next')],
        has_more: true,
        unread_count: null,
      }),
    } as Response);
    await Promise.all([first, second]);

    expect(notifications.get().map((item) => item.id)).toEqual([
      'existing',
      'next',
    ]);
    expect(unread.get()).toBe(7);
  });

  it('does not queue a refresh when a concurrent append request is already in flight', async () => {
    const { deps } = createDeps('cursor-1');
    const pendingRefreshRef = { current: false };
    deps.pendingRefreshRef = pendingRefreshRef;
    let resolveResponse: (response: Response) => void = () => undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveResponse = resolve;
          })
      )
    );

    const first = fetchNotificationsRequest(true, deps);
    await fetchNotificationsRequest(true, deps);

    expect(pendingRefreshRef.current).toBe(false);
    resolveResponse({
      ok: true,
      json: async () => ({
        cursor: 'cursor-2',
        data: [notification('next')],
        has_more: true,
        unread_count: null,
      }),
    } as Response);
    await first;
  });

  it('queues a realtime refresh that arrives during an in-flight fetch', async () => {
    const { deps } = createDeps();
    const pendingRefreshRef = { current: false };
    deps.pendingRefreshRef = pendingRefreshRef;
    const resolvers: Array<(response: Response) => void> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolvers.push(resolve);
          })
      )
    );

    const first = fetchNotificationsRequest(false, deps);
    await Promise.resolve();
    await fetchNotificationsRequest(false, deps);
    expect(pendingRefreshRef.current).toBe(true);
    const response = {
      ok: true,
      json: async () => ({
        data: [],
        has_more: false,
        cursor: null,
        unread_count: 0,
      }),
    } as Response;
    resolvers.shift()?.(response);
    await first;
    await Promise.resolve();
    expect(global.fetch).toHaveBeenCalledTimes(2);
    resolvers.shift()?.(response);
  });

  it('does not apply list state after the request generation is superseded', async () => {
    const { deps, notifications, unread } = createDeps();
    let current = true;
    deps.isCurrent = () => current;
    let resolveResponse: (response: Response) => void = () => undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveResponse = resolve;
          })
      )
    );

    const pending = fetchNotificationsRequest(false, deps);
    current = false;
    resolveResponse({
      ok: true,
      json: async () => ({
        cursor: null,
        data: [notification('stale')],
        has_more: false,
        unread_count: 9,
      }),
    } as Response);
    await pending;

    expect(notifications.get()).toEqual([]);
    expect(unread.get()).toBe(7);
  });
});
