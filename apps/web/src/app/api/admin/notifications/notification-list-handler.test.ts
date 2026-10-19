import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({ logger: { error: mocks.loggerError } }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));

import { listAdminNotifications } from './notification-list-handler';

const notification = {
  action_label: null,
  action_url: null,
  channels: ['in_app'],
  created_at: '2026-08-05T10:00:00.000Z',
  created_by: '123e4567-e89b-12d3-a456-426614174001',
  delivery_attempts: 0,
  delivery_state: 'pending',
  expires_at: null,
  id: '123e4567-e89b-12d3-a456-426614174000',
  is_system: false,
  message: 'Message',
  notification_type: 'info',
  priority: 'normal',
  scheduled_for: null,
  sent_at: null,
  target_merchant_ids: ['123e4567-e89b-12d3-a456-426614174111'],
  target_segment: null,
  target_type: 'specific',
  template_id: null,
  title: 'Title',
};

function createSupabase() {
  const query = {
    eq: vi.fn(),
    gt: vi.fn(),
    lte: vi.fn(),
    or: vi.fn(),
    order: vi.fn(),
    range: vi.fn(),
    select: vi.fn(),
  };
  query.eq.mockReturnValue(query);
  query.gt.mockReturnValue(query);
  query.lte.mockReturnValue(query);
  query.or.mockReturnValue(query);
  query.order.mockReturnValue(query);
  query.select.mockReturnValue(query);
  query.range.mockResolvedValue({
    count: 1,
    data: [notification],
    error: null,
  });
  const rpc = vi
    .fn()
    .mockResolvedValueOnce({
      data: [
        {
          notification_id: notification.id,
          read_rate: 0,
          total_dismissed: 0,
          total_read: 0,
          total_sent: 0,
        },
      ],
      error: null,
    })
    .mockResolvedValueOnce({
      data: {
        activeBanners: 0,
        avgReadRate: 0,
        deliveryExpired: 0,
        deliveryFailed: 0,
        deliveryPending: 1,
        deliveryProcessing: 0,
        scheduled: 0,
        totalSent: 0,
      },
      error: null,
    });
  return { from: vi.fn(() => query), query, rpc };
}

describe('listAdminNotifications', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects invalid query pagination before using the database', async () => {
    const response = await listAdminNotifications('http://localhost?limit=101');

    expect(response.status).toBe(400);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it('escapes wildcard search input and redacts sensitive target IDs', async () => {
    const supabase = createSupabase();
    mocks.createClient.mockResolvedValue(supabase);

    const response = await listAdminNotifications(
      'http://localhost?search=100%_off'
    );

    expect(response.status).toBe(200);
    expect(supabase.query.or).toHaveBeenCalledWith(
      'title.ilike.*"100\\%\\_off"*,message.ilike.*"100\\%\\_off"*'
    );
    await expect(response.json()).resolves.toMatchObject({
      data: [{ delivery_last_error: null, target_merchant_ids: [] }],
    });
  });

  it('returns forbidden when the statistics RPC rejects the admin role', async () => {
    const supabase = createSupabase();
    supabase.rpc.mockReset();
    supabase.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: '42501', message: 'denied' },
    });
    mocks.createClient.mockResolvedValue(supabase);

    const response = await listAdminNotifications('http://localhost');

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: 'Failed to fetch notification delivery statistics',
    });
  });
});
