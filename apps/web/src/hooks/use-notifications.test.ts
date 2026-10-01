import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import './use-notifications.test-support';
import { useNotifications, useNotificationsSafe } from './use-notifications';
import { renderNotificationsHook } from './use-notifications.test-render';
import {
  activeBanner,
  notificationMocks,
  notificationResponse,
  notificationRow,
  resetNotificationHookMocks,
  setMerchant,
  setSafeMerchant,
} from './use-notifications.test-support';

beforeEach(resetNotificationHookMocks);

describe('useNotifications fetching', () => {
  it('starts idle and exposes all actions without a merchant', () => {
    setMerchant(null);

    const { result } = renderNotificationsHook(() => useNotifications());

    expect(result.current).toMatchObject({
      activeBanners: [],
      error: null,
      hasMore: false,
      isLoading: false,
      notifications: [],
      unreadCount: 0,
    });
    expect(result.current).toMatchObject({
      dismiss: expect.any(Function),
      dismissBanner: expect.any(Function),
      loadMore: expect.any(Function),
      markAllAsRead: expect.any(Function),
      markAsRead: expect.any(Function),
      refetch: expect.any(Function),
    });
  });

  it('fetches notifications and active banners for the resolved merchant', async () => {
    const notifications = [notificationRow()];
    const banners = [activeBanner()];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: async () =>
          notificationResponse(notifications, { unreadCount: 1 }),
        ok: true,
      })
    );
    notificationMocks.rpc.mockResolvedValue({ data: banners, error: null });

    const { result } = renderNotificationsHook(() => useNotifications());

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/notifications?limit=20')
    );
    expect(result.current.notifications).toEqual(notifications);
    expect(result.current.unreadCount).toBe(1);
    expect(result.current.activeBanners).toEqual(banners);
    expect(notificationMocks.rpc).toHaveBeenCalledWith('get_active_banners', {
      p_merchant_id: 'merchant-123',
    });
  });

  it('does not fetch when merchant context is absent', async () => {
    setMerchant(null);
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    renderNotificationsHook(() => useNotifications());
    await Promise.resolve();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(notificationMocks.supabaseChannel).not.toHaveBeenCalled();
  });

  it('stores rejected fetch errors without throwing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('Network error'))
    );
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    const { result } = renderNotificationsHook(() => useNotifications());

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current).toMatchObject({
      error: 'Network error',
      notifications: [],
    });
    error.mockRestore();
  });

  it('surfaces rate limiting without blocking fetch state', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: async () => ({}),
        ok: false,
        status: 429,
      })
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const { result } = renderNotificationsHook(() => useNotifications());

    await waitFor(() => {
      expect(result.current.error).toBe(
        'Notifications are rate limited. Please try again later.'
      );
    });
    expect(result.current.isLoading).toBe(false);
    expect(warn).toHaveBeenCalledWith('Rate limit exceeded for notifications.');
    warn.mockRestore();
  });

  it('logs non-OK responses and leaves notifications empty', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: async () => ({ error: 'Server error' }),
        ok: false,
        status: 500,
      })
    );
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    const { result } = renderNotificationsHook(() => useNotifications());

    await waitFor(() => {
      expect(error).toHaveBeenCalledWith(
        'Failed to fetch notifications:',
        500,
        {
          error: 'Server error',
        }
      );
    });
    expect(result.current.notifications).toEqual([]);
    error.mockRestore();
  });

  it('uses the returned cursor when loading more notifications', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () =>
        notificationResponse([], { cursor: 'test-cursor', hasMore: true }),
      ok: true,
    });
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderNotificationsHook(() => useNotifications());

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    fetchMock.mockClear();
    await act(async () => {
      await result.current.loadMore();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('cursor=test-cursor')
    );
  });

  it('does not reconnect when merchant context rerenders with the same ID', async () => {
    const { rerender } = renderNotificationsHook(() => useNotifications());

    await waitFor(() => {
      expect(notificationMocks.supabaseChannel).toHaveBeenCalledTimes(1);
    });
    setMerchant('merchant-123');
    rerender();

    expect(notificationMocks.supabaseChannel).toHaveBeenCalledTimes(1);
  });

  it('coalesces a refetch requested while the initial list request is pending', async () => {
    let resolveResponse:
      | ((response: { json: () => Promise<unknown>; ok: boolean }) => void)
      | undefined;
    const fetchMock = vi.fn(
      () =>
        new Promise<{ json: () => Promise<unknown>; ok: boolean }>(
          (resolve) => {
            resolveResponse = resolve;
          }
        )
    );
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderNotificationsHook(() => useNotifications());

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    let refetch: Promise<void> | undefined;
    act(() => {
      refetch = result.current.refetch();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const settleResponse = resolveResponse;
    const pendingRefetch = refetch;
    if (!settleResponse || !pendingRefetch) {
      throw new Error('Expected the initial request and refetch to be pending');
    }
    await act(async () => {
      settleResponse({
        json: async () => notificationResponse([]),
        ok: true,
      });
      await pendingRefetch;
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('useNotificationsSafe', () => {
  it('returns the notifications result when merchant context exists', async () => {
    setSafeMerchant();

    const { result } = renderNotificationsHook(() => useNotificationsSafe());

    expect(result.current?.notifications).toEqual([]);
    await waitFor(() => expect(result.current?.isLoading).toBe(false));
  });

  it('returns null and does not fetch outside MerchantProvider', () => {
    setSafeMerchant(null);
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const { result } = renderHook(() => useNotificationsSafe());

    expect(result.current).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
