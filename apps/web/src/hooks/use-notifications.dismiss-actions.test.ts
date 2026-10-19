import { waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import './use-notifications.test-support';
import { useNotifications } from './use-notifications';
import { renderNotificationsHook } from './use-notifications.test-render';
import {
  activeBanner,
  notificationMocks,
  notificationResponse,
  notificationRow,
  resetNotificationHookMocks,
} from './use-notifications.test-support';

beforeEach(resetNotificationHookMocks);

describe('useNotifications dismissal actions', () => {
  it('dismisses a notification and removes it from local state', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        json: async () =>
          notificationResponse([notificationRow()], { unreadCount: 1 }),
        ok: true,
      })
      .mockResolvedValueOnce({
        json: async () => ({ unread_count: 0 }),
        ok: true,
      });

    const { result } = renderNotificationsHook(() => useNotifications());

    await waitFor(() => expect(result.current.notifications).toHaveLength(1));
    await result.current.dismiss('notif-1');

    expect(notificationMocks.fetchWithCsrf).toHaveBeenCalledWith(
      '/api/notifications/notif-1',
      expect.objectContaining({
        body: JSON.stringify({ dismissed: true }),
        headers: { 'Content-Type': 'application/json' },
        method: 'PATCH',
      })
    );
    await waitFor(() => expect(result.current.notifications).toHaveLength(0));
    expect(result.current.unreadCount).toBe(0);
  });

  it('throws when dismissing a notification fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });

    const { result } = renderNotificationsHook(() => useNotifications());

    await expect(result.current.dismiss('notif-1')).rejects.toThrow(
      'Failed to dismiss notification'
    );
    expect(notificationMocks.fetchWithCsrf).toHaveBeenCalledWith(
      '/api/notifications/notif-1',
      expect.objectContaining({
        body: JSON.stringify({ dismissed: true }),
        method: 'PATCH',
      })
    );
  });

  it('dismisses an active banner locally', async () => {
    const banners = [activeBanner()];
    notificationMocks.rpc.mockResolvedValue({ data: banners, error: null });
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        json: async () => notificationResponse([]),
        ok: true,
      })
      .mockResolvedValueOnce({ json: async () => ({}), ok: true });

    const { result } = renderNotificationsHook(() => useNotifications());

    await waitFor(() => expect(result.current.activeBanners).toHaveLength(1));
    await result.current.dismissBanner('banner-1');

    expect(notificationMocks.fetchWithCsrf).toHaveBeenCalledWith(
      '/api/notifications/banner-1',
      expect.objectContaining({
        body: JSON.stringify({ banner_dismissed: true }),
        method: 'PATCH',
      })
    );
    await waitFor(() => expect(result.current.activeBanners).toHaveLength(0));
  });

  it('throws when dismissing an active banner fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });

    const { result } = renderNotificationsHook(() => useNotifications());

    await expect(result.current.dismissBanner('banner-1')).rejects.toThrow(
      'Failed to dismiss banner'
    );
    expect(notificationMocks.fetchWithCsrf).toHaveBeenCalledWith(
      '/api/notifications/banner-1',
      expect.objectContaining({
        body: JSON.stringify({ banner_dismissed: true }),
        method: 'PATCH',
      })
    );
  });

  it('refetches notifications and banners', async () => {
    const { result } = renderNotificationsHook(() => useNotifications());

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    vi.clearAllMocks();

    await result.current.refetch();

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/notifications?limit=20')
    );
    expect(notificationMocks.rpc).toHaveBeenCalledWith('get_active_banners', {
      p_merchant_id: 'merchant-123',
    });
  });
});
