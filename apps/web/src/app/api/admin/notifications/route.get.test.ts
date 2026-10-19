import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('@/lib/admin-notification-auth', () => ({
  authorizeNotificationAdmin: mocks.authorize,
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => ({ from: mocks.from, rpc: mocks.rpc })),
}));

import { GET } from './route';

const notification = {
  action_label: null,
  action_url: null,
  channels: ['in_app'],
  created_at: '2026-06-02T08:00:00.000Z',
  delivery_state: 'pending',
  id: 'notification-1',
  message: 'This is a test notification',
  notification_type: 'info',
  priority: 'high',
  sent_at: null,
  title: 'Test Notification',
};

function mockNotificationList() {
  const query = {
    eq: vi.fn(),
    gt: vi.fn(),
    is: vi.fn(),
    lte: vi.fn(),
    not: vi.fn(),
    or: vi.fn(),
    order: vi.fn(),
    range: vi.fn().mockResolvedValue({
      count: 1,
      data: [notification],
      error: null,
    }),
  };
  query.eq.mockReturnValue(query);
  query.gt.mockReturnValue(query);
  query.is.mockReturnValue(query);
  query.lte.mockReturnValue(query);
  query.not.mockReturnValue(query);
  query.or.mockReturnValue(query);
  query.order.mockReturnValue(query);
  mocks.from.mockReturnValue({ select: vi.fn(() => query) });
  return query;
}

function mockDeliveryStatistics() {
  mocks.rpc
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
}

describe('GET /api/admin/notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authorize.mockResolvedValue({
      status: 'authorized',
      userId: 'user-1',
    });
    mockNotificationList();
  });

  it('fails honestly when delivery statistics cannot be loaded', async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'XX000', message: 'stats unavailable' },
    });

    const response = await GET(
      new NextRequest('https://usebaci.com/api/admin/notifications')
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: 'Failed to fetch notification delivery statistics',
    });
  });

  it('fails honestly when delivery statistics omit a listed notification', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: [], error: null });

    const response = await GET(
      new NextRequest('https://usebaci.com/api/admin/notifications')
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: 'Failed to fetch notification delivery statistics',
    });
  });

  it('filters queued work by durable state and due time', async () => {
    const query = mockNotificationList();
    mockDeliveryStatistics();

    const response = await GET(
      new NextRequest(
        'https://usebaci.com/api/admin/notifications?status=queued'
      )
    );

    expect(response.status).toBe(200);
    expect(query.eq).toHaveBeenCalledWith('delivery_state', 'pending');
    expect(query.lte).toHaveBeenCalledWith('scheduled_for', expect.any(String));
  });

  it('redacts target merchant IDs from notification lists', async () => {
    const query = mockNotificationList();
    query.range.mockResolvedValueOnce({
      count: 1,
      data: [{ ...notification, target_merchant_ids: ['merchant-secret'] }],
      error: null,
    });
    mockDeliveryStatistics();

    const response = await GET(
      new NextRequest('https://usebaci.com/api/admin/notifications')
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: [{ target_merchant_ids: [] }],
    });
  });
});
