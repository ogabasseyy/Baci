import { describe, expect, it, vi } from 'vitest';
import { fetchWithCsrf } from '@/lib/api-client';
import type { MerchantNotificationWithDetails } from '@/types/notifications';
import { markAllNotificationsAsRead } from './notification-actions';

vi.mock('@/lib/api-client', () => ({ fetchWithCsrf: vi.fn() }));

describe('markAllNotificationsAsRead', () => {
  it('preserves the current count when the server reports an unavailable count', async () => {
    vi.mocked(fetchWithCsrf).mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, unread_count: null }),
    } as Response);
    const setNotifications = vi.fn();
    const setUnreadCount = vi.fn();

    const notifications: MerchantNotificationWithDetails[] = [
      {
        id: 'recipient-1',
        notification_id: 'notification-1',
        merchant_id: 'merchant-1',
        read_at: null,
        dismissed_at: null,
        banner_dismissed_at: null,
        created_at: '2026-08-05T00:00:00.000Z',
        notification: {
          id: 'notification-1',
          template_id: null,
          title: 'Test',
          message: 'Test message',
          notification_type: 'info',
          priority: 'normal',
          target_type: 'all',
          target_merchant_ids: [],
          target_segment: null,
          channels: ['in_app'],
          action_url: null,
          action_label: null,
          scheduled_for: null,
          expires_at: null,
          created_by: 'admin-1',
          created_at: '2026-08-05T00:00:00.000Z',
          delivery_attempts: 0,
          delivery_last_error: null,
          delivery_state: 'sent',
          sent_at: '2026-08-05T00:00:00.000Z',
          is_system: false,
        },
      },
    ];

    await markAllNotificationsAsRead(
      notifications,
      setNotifications,
      setUnreadCount
    );

    expect(setNotifications).toHaveBeenCalledOnce();
    expect(setUnreadCount).not.toHaveBeenCalled();
  });
});
