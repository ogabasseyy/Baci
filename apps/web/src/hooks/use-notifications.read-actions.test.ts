import { waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import './use-notifications.test-support';
import { useNotifications } from './use-notifications';
import { renderNotificationsHook } from './use-notifications.test-render';
import {
  notificationMocks,
  notificationResponse,
  notificationRow,
  resetNotificationHookMocks,
} from './use-notifications.test-support';

beforeEach(resetNotificationHookMocks);

function unreadNotificationsResponse() {
  return notificationResponse([notificationRow()], { unreadCount: 1 });
}

describe('useNotifications read actions', () => {
  it('marks a notification as read and updates local state', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        json: async () => unreadNotificationsResponse(),
        ok: true,
      })
      .mockResolvedValueOnce({
        json: async () => ({ unread_count: 0 }),
        ok: true,
      });

    const { result } = renderNotificationsHook(() => useNotifications());

    await waitFor(() => expect(result.current.notifications).toHaveLength(1));
    await result.current.markAsRead('notif-1');

    expect(notificationMocks.fetchWithCsrf).toHaveBeenCalledWith(
      '/api/notifications/notif-1',
      expect.objectContaining({
        body: JSON.stringify({ read: true }),
        headers: { 'Content-Type': 'application/json' },
        method: 'PATCH',
      })
    );
    await waitFor(() =>
      expect(result.current.notifications[0].read_at).not.toBeNull()
    );
    expect(result.current.unreadCount).toBe(0);
  });

  it('throws when marking a notification as read fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });

    const { result } = renderNotificationsHook(() => useNotifications());

    await expect(result.current.markAsRead('notif-1')).rejects.toThrow(
      'Failed to mark as read'
    );
    expect(notificationMocks.fetchWithCsrf).toHaveBeenCalledWith(
      '/api/notifications/notif-1',
      expect.objectContaining({
        body: JSON.stringify({ read: true }),
        method: 'PATCH',
      })
    );
  });

  it('bulk marks all unread notifications as read', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        json: async () => unreadNotificationsResponse(),
        ok: true,
      })
      .mockResolvedValueOnce({
        json: async () => ({ success: true, unread_count: 0 }),
        ok: true,
      });

    const { result } = renderNotificationsHook(() => useNotifications());

    await waitFor(() => expect(result.current.notifications).toHaveLength(1));
    await result.current.markAllAsRead();

    expect(notificationMocks.fetchWithCsrf).toHaveBeenCalledWith(
      '/api/notifications/mark-all-read',
      expect.objectContaining({ method: 'PATCH' })
    );
    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      '/api/notifications/mark-all-read',
      expect.objectContaining({
        headers: { 'Content-Type': 'application/json' },
        method: 'PATCH',
      })
    );
    await waitFor(() => {
      expect(result.current.notifications[0].read_at).not.toBeNull();
      expect(result.current.unreadCount).toBe(0);
    });
  });

  it('throws when bulk mark-all fails', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        json: async () => unreadNotificationsResponse(),
        ok: true,
      })
      .mockResolvedValueOnce({
        json: async () => ({}),
        ok: false,
        status: 500,
      });

    const { result } = renderNotificationsHook(() => useNotifications());

    await waitFor(() => expect(result.current.notifications).toHaveLength(1));
    await expect(result.current.markAllAsRead()).rejects.toThrow(
      'Failed to mark all as read'
    );
  });

  it('does not call the bulk endpoint without unread notifications', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      json: async () =>
        notificationResponse(
          [notificationRow({ read_at: '2026-02-10T12:00:00Z' })],
          { unreadCount: 0 }
        ),
      ok: true,
    });

    const { result } = renderNotificationsHook(() => useNotifications());

    await waitFor(() => expect(result.current.notifications).toHaveLength(1));
    await result.current.markAllAsRead();

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
