import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DELETE, GET } from './route';

const mockCreateClient = vi.fn();
const mockAuthorizeNotificationAdmin = vi.fn();

vi.mock('@/lib/admin-notification-auth', () => ({
  authorizeNotificationAdmin: () => mockAuthorizeNotificationAdmin(),
}));

const mockCheckCsrfProtection = vi.fn();
vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: (...args: unknown[]) => mockCheckCsrfProtection(...args),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: (...args: unknown[]) => mockCreateClient(...args),
}));

function createRequest(): NextRequest {
  return new Request('http://localhost/api/admin/notifications/123', {
    method: 'DELETE',
  }) as NextRequest;
}

function createMockSupabase(options?: {
  deleteError?: { message: string } | null;
  deleteReturnsRow?: boolean;
  notification?: {
    delivery_state: string;
    id: string;
    sent_at: string | null;
    target_merchant_ids?: string[] | null;
    target_segment?: string | null;
    target_type?: string;
    title?: string;
  } | null;
}) {
  const notification = options?.notification ?? {
    delivery_state: 'pending',
    id: '123e4567-e89b-12d3-a456-426614174000',
    sent_at: null,
    target_merchant_ids: null,
    target_segment: null,
    target_type: 'all',
    title: 'Launch update',
  };
  const deleteError = options?.deleteError ?? null;
  const deleteReturnsRow = options?.deleteReturnsRow ?? true;

  const notificationsDeleteQuery = {
    eq: vi.fn(),
    is: vi.fn(),
    maybeSingle: vi.fn(async () => ({
      data: deleteReturnsRow ? { id: notification?.id } : null,
      error: deleteError,
    })),
    select: vi.fn(),
  };
  notificationsDeleteQuery.eq.mockReturnValue(notificationsDeleteQuery);
  notificationsDeleteQuery.is.mockReturnValue(notificationsDeleteQuery);
  notificationsDeleteQuery.select.mockReturnValue(notificationsDeleteQuery);

  const notificationsQuery = {
    delete: vi.fn(() => notificationsDeleteQuery),
    eq: vi.fn(() => notificationsQuery),
    single: vi.fn(async () => ({
      data: notification,
      error: notification ? null : { message: 'not found' },
    })),
    select: vi.fn(() => notificationsQuery),
    update: vi.fn(() => notificationsQuery),
  };

  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: 'user-1' } },
        error: null,
      }),
    },
    from: vi.fn((table: string) => {
      if (table === 'notifications') {
        return notificationsQuery;
      }

      throw new Error(`Unexpected table: ${table}`);
    }),
    rpc: vi.fn().mockResolvedValue({
      data: {
        deliveries: [
          {
            business_name: 'Baci Store',
            created_at: '2026-08-05T12:00:00.000Z',
            dismissed_at: null,
            id: '123e4567-e89b-12d3-a456-426614174111',
            merchant_id: '123e4567-e89b-12d3-a456-426614174112',
            read_at: '2026-08-05T12:01:00.000Z',
          },
        ],
        notification: {
          action_label: null,
          action_url: null,
          channels: ['in_app'],
          created_at: '2026-08-05T12:00:00.000Z',
          created_by: '123e4567-e89b-12d3-a456-426614174113',
          delivery_attempts: 0,
          delivery_last_error: null,
          delivery_state: 'pending',
          expires_at: null,
          id: '123e4567-e89b-12d3-a456-426614174000',
          is_system: false,
          message: 'Launch update',
          notification_type: 'info',
          priority: 'normal',
          scheduled_for: null,
          sent_at: null,
          target_merchant_ids: [],
          target_segment: null,
          target_type: 'all',
          template_id: null,
          title: 'Launch update',
        },
        stats: {
          read_rate: 41.67,
          total_dismissed: 0,
          total_read: 5,
          total_sent: 12,
        },
      },
      error: null,
    }),
  };
}

describe('/api/admin/notifications/[id]', () => {
  let mockSupabase = createMockSupabase();

  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockSupabase = createMockSupabase();
    mockCreateClient.mockReturnValue(mockSupabase);
    mockAuthorizeNotificationAdmin.mockResolvedValue({
      status: 'authorized',
      userId: 'user-1',
    });
    mockCheckCsrfProtection.mockResolvedValue({ valid: true });
  });

  it('returns the fixed admin RPC projection with delivery stats and records', async () => {
    const response = await GET({} as unknown as NextRequest, {
      params: Promise.resolve({
        id: '123e4567-e89b-12d3-a456-426614174000',
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      id: '123e4567-e89b-12d3-a456-426614174000',
      stats: {
        total_sent: 12,
        total_read: 5,
      },
      deliveries: [expect.objectContaining({ business_name: 'Baci Store' })],
    });
    expect(mockSupabase.rpc).toHaveBeenCalledWith(
      'get_admin_notification_detail',
      { p_notification_id: '123e4567-e89b-12d3-a456-426614174000' }
    );
  });

  it('returns 500 when the fixed detail projection is invalid', async () => {
    mockSupabase.rpc.mockResolvedValueOnce({
      data: { notification: {} },
      error: null,
    });

    const response = await GET({} as unknown as NextRequest, {
      params: Promise.resolve({
        id: '123e4567-e89b-12d3-a456-426614174000',
      }),
    });

    expect(response.status).toBe(500);
  });

  it('returns 403 when CSRF validation fails on DELETE', async () => {
    mockCheckCsrfProtection.mockResolvedValueOnce({
      valid: false,
      response: NextResponse.json(
        { error: 'Invalid CSRF token' },
        { status: 403 }
      ),
    });

    const response = await DELETE(createRequest(), {
      params: Promise.resolve({ id: '123e4567-e89b-12d3-a456-426614174000' }),
    });
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe('Invalid CSRF token');
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  it('authenticates before validating CSRF on DELETE', async () => {
    mockAuthorizeNotificationAdmin.mockResolvedValueOnce({
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
      status: 'error',
    });

    const response = await DELETE(createRequest(), {
      params: Promise.resolve({ id: '123e4567-e89b-12d3-a456-426614174000' }),
    });

    expect(response.status).toBe(401);
    expect(mockCheckCsrfProtection).not.toHaveBeenCalled();
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  it('deletes notifications after passing CSRF validation', async () => {
    const response = await DELETE(createRequest(), {
      params: Promise.resolve({ id: '123e4567-e89b-12d3-a456-426614174000' }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      message: 'Pending notification cancelled',
      success: true,
    });
    expect(mockCreateClient).toHaveBeenCalled();
  });

  it('retains sent notification history instead of deleting it', async () => {
    mockSupabase = createMockSupabase({
      notification: {
        delivery_state: 'sent',
        id: '123e4567-e89b-12d3-a456-426614174000',
        sent_at: '2026-08-05T12:00:00.000Z',
      },
    });
    mockCreateClient.mockReturnValue(mockSupabase);

    const response = await DELETE(createRequest(), {
      params: Promise.resolve({ id: '123e4567-e89b-12d3-a456-426614174000' }),
    });

    expect(response.status).toBe(409);
  });

  it('does not delete a notification claimed after the preflight read', async () => {
    mockSupabase = createMockSupabase({ deleteReturnsRow: false });
    mockCreateClient.mockReturnValue(mockSupabase);

    const response = await DELETE(createRequest(), {
      params: Promise.resolve({ id: '123e4567-e89b-12d3-a456-426614174000' }),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: 'Notification delivery has already started',
    });
  });
});
