import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hasPermission } from '@/lib/api-auth';
import {
  getMerchantForApiRequest,
  toUserAccess,
} from '@/lib/get-merchant-for-api-request';
import { createClient } from '@/lib/supabase/server';
import { GET } from './route';

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ get: vi.fn(), set: vi.fn() }),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

vi.mock('@/lib/get-merchant-for-api-request', () => ({
  getMerchantForApiRequest: vi.fn(),
  toUserAccess: vi.fn(),
}));

vi.mock('@/lib/api-auth', () => ({
  hasPermission: vi.fn(),
}));

function createListQuery(result: unknown) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    is: vi.fn(),
    or: vi.fn(),
    order: vi.fn(),
    lt: vi.fn(),
    limit: vi.fn().mockResolvedValue(result),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.is.mockReturnValue(query);
  query.or.mockReturnValue(query);
  query.order.mockReturnValue(query);
  query.lt.mockReturnValue(query);
  return query;
}

function createUnreadCountQuery(result: unknown) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    is: vi.fn(),
    or: vi.fn().mockResolvedValue(result),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.is.mockReturnValue(query);
  return query;
}

describe('GET /api/notifications', () => {
  const merchantId = 'merchant-123';
  let listQuery = createListQuery({ data: [], error: null });
  let unreadCountQuery = createUnreadCountQuery({ count: 0, error: null });
  let from = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    listQuery = createListQuery({
      data: [
        {
          id: '123e4567-e89b-42d3-a456-426614174001',
          notification_id: '123e4567-e89b-42d3-a456-426614174002',
          merchant_id: '123e4567-e89b-42d3-a456-426614174003',
          in_app_visible: true,
          created_at: '2026-08-05T10:00:00.000Z',
          read_at: null,
          dismissed_at: null,
          banner_dismissed_at: null,
          notification: {
            id: '123e4567-e89b-42d3-a456-426614174002',
            title: 'Inventory update',
            message: 'New stock is available.',
            notification_type: 'info',
            priority: 'normal',
            channels: ['in_app'],
            action_url: null,
            action_label: null,
            expires_at: null,
            created_at: '2026-08-05T10:00:00.000Z',
            is_system: false,
          },
        },
      ],
      error: null,
    });
    unreadCountQuery = createUnreadCountQuery({ count: 1, error: null });
    from = vi
      .fn()
      .mockReturnValueOnce(listQuery)
      .mockReturnValueOnce(unreadCountQuery);

    vi.mocked(createClient).mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'user-123' } },
          error: null,
        }),
      },
      from,
    } as unknown as ReturnType<typeof createClient>);
    vi.mocked(getMerchantForApiRequest).mockResolvedValue({
      merchantId,
      merchantSlug: 'test-store',
      businessName: 'Test store',
      staffAccess: {},
      roles: ['owner'],
    } as unknown as Awaited<ReturnType<typeof getMerchantForApiRequest>>);
    vi.mocked(toUserAccess).mockReturnValue({
      role: 'owner',
    } as unknown as ReturnType<typeof toUserAccess>);
    vi.mocked(hasPermission).mockReturnValue(true);
  });

  it.each([
    'cursor=not-a-timestamp',
    'limit=0',
    'limit=51',
    'limit=not-a-number',
    'unread_only=1',
    'type=debug',
  ])('rejects invalid query input: %s', async (query) => {
    const response = await GET(
      new NextRequest(`http://localhost/api/notifications?${query}`)
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Invalid notification query',
    });
    expect(from).not.toHaveBeenCalled();
  });

  it('filters parent notifications to sent and unexpired records in both queries', async () => {
    const response = await GET(
      new NextRequest(
        'http://localhost/api/notifications?unread_only=true&type=info'
      )
    );

    expect(response.status).toBe(200);
    expect(listQuery.eq).toHaveBeenCalledWith(
      'notification.delivery_state',
      'sent'
    );
    expect(unreadCountQuery.eq).toHaveBeenCalledWith(
      'notification.delivery_state',
      'sent'
    );
    expect(listQuery.or).toHaveBeenCalledWith(
      expect.stringMatching(/^expires_at\.is\.null,expires_at\.gt\.\d{4}-/),
      { referencedTable: 'notification' }
    );
    expect(unreadCountQuery.or).toHaveBeenCalledWith(
      expect.stringMatching(/^expires_at\.is\.null,expires_at\.gt\.\d{4}-/),
      { referencedTable: 'notification' }
    );
  });

  it('does not report an unread count of zero when the count query fails', async () => {
    unreadCountQuery.or.mockResolvedValueOnce({
      count: null,
      error: { message: 'database details must not leak' },
    });

    const response = await GET(
      new NextRequest('http://localhost/api/notifications')
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: 'Failed to fetch notification count',
    });
  });

  it('does not expose database details when the notification query fails', async () => {
    const error = { message: 'database details must not leak' };
    listQuery.limit.mockResolvedValueOnce({ data: null, error });
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    const response = await GET(
      new NextRequest('http://localhost/api/notifications')
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: 'Failed to fetch notifications',
    });
    expect(consoleError).toHaveBeenCalledWith('Failed to fetch notifications', {
      errorCode: 'unknown',
    });
    expect(consoleError).not.toHaveBeenCalledWith(expect.anything(), error);
  });

  it('fails closed when a joined notification row has an invalid contract', async () => {
    listQuery.limit.mockResolvedValueOnce({
      data: [
        { id: '123e4567-e89b-42d3-a456-426614174001', notification: null },
      ],
      error: null,
    });
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    const response = await GET(
      new NextRequest('http://localhost/api/notifications')
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: 'Failed to fetch notifications',
    });
    expect(consoleError).toHaveBeenCalledWith('Failed to fetch notifications', {
      errorCode: 'invalid_notification_result',
    });
  });
});
