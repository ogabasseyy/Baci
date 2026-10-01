import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({ logger: { error: mocks.loggerError } }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));

import { getAdminNotificationDetail } from './notification-detail-handler';

const notificationId = '123e4567-e89b-12d3-a456-426614174000';
const detail = {
  deliveries: [],
  notification: {
    action_label: null,
    action_url: null,
    channels: ['in_app'],
    created_at: '2026-08-05T10:00:00.000Z',
    created_by: '123e4567-e89b-12d3-a456-426614174001',
    delivery_attempts: 0,
    delivery_last_error: null,
    delivery_state: 'pending',
    expires_at: null,
    id: notificationId,
    is_system: false,
    message: 'Message',
    notification_type: 'info',
    priority: 'normal',
    scheduled_for: null,
    sent_at: null,
    target_merchant_ids: [],
    target_segment: null,
    target_type: 'all',
    template_id: null,
    title: 'Title',
  },
  stats: { read_rate: 0, total_dismissed: 0, total_read: 0, total_sent: 0 },
};

describe('getAdminNotificationDetail', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the schema-validated detail RPC projection', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: detail, error: null });
    mocks.createClient.mockResolvedValue({ rpc });

    const response = await getAdminNotificationDetail(notificationId);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      id: notificationId,
      stats: detail.stats,
    });
    expect(rpc).toHaveBeenCalledWith('get_admin_notification_detail', {
      p_notification_id: notificationId,
    });
  });

  it('maps an RLS denial to forbidden without exposing database detail', async () => {
    mocks.createClient.mockResolvedValue({
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { code: '42501', message: 'permission denied' },
      }),
    });

    const response = await getAdminNotificationDetail(notificationId);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: 'Forbidden - Admin access required',
    });
  });

  it('fails closed for an invalid RPC payload', async () => {
    mocks.createClient.mockResolvedValue({
      rpc: vi
        .fn()
        .mockResolvedValue({ data: { notification: {} }, error: null }),
    });

    const response = await getAdminNotificationDetail(notificationId);

    expect(response.status).toBe(500);
  });
});
