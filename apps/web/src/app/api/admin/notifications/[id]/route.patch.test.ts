import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PATCH } from './route';

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
    error: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: (...args: unknown[]) => mockCreateClient(...args),
}));

function createRequest(
  body: Record<string, unknown> = { title: 'Updated title' }
): NextRequest {
  return new Request('http://localhost/api/admin/notifications/123', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  }) as NextRequest;
}

function createMockSupabase(options?: {
  notification?: {
    delivery_state: string;
    id: string;
    sent_at: string | null;
    target_merchant_ids?: string[] | null;
    target_segment?: string | null;
    target_type?: string;
    title?: string;
  } | null;
  updatedNotification?: Record<string, unknown>;
  updateReturnsRow?: boolean;
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
  const updateReturnsRow = options?.updateReturnsRow ?? true;
  const updatedNotification = options?.updatedNotification ?? notification;
  const notificationUpdates: Record<string, unknown>[] = [];

  const merchantsQuery = {
    eq: vi.fn(() => merchantsQuery),
    in: vi.fn((_: string, ids: string[]) =>
      Promise.resolve({ data: ids.map((id) => ({ id })), error: null })
    ),
    select: vi.fn(() => merchantsQuery),
  };

  const notificationsQuery = {
    eq: vi.fn(() => notificationsQuery),
    is: vi.fn(() => notificationsQuery),
    maybeSingle: vi.fn(async () => ({
      data: updateReturnsRow ? updatedNotification : null,
      error: null,
    })),
    single: vi.fn(async () => ({
      data: notification,
      error: notification ? null : { message: 'not found' },
    })),
    select: vi.fn(() => notificationsQuery),
    update: vi.fn((payload: Record<string, unknown>) => {
      notificationUpdates.push(payload);
      return notificationsQuery;
    }),
  };

  return {
    __notificationUpdates: notificationUpdates,
    __notificationsQuery: notificationsQuery,
    from: vi.fn((table: string) => {
      if (table === 'merchants') return merchantsQuery;
      if (table === 'notifications') return notificationsQuery;
      throw new Error(`Unexpected table: ${table}`);
    }),
    rpc: vi.fn((fn: string) => {
      if (fn === 'resolve_admin_notification_target_merchant_ids_v1') {
        return Promise.resolve({
          data: ['123e4567-e89b-12d3-a456-426614174111'],
          error: null,
        });
      }
      throw new Error(`Unexpected RPC: ${fn}`);
    }),
  };
}

describe('PATCH /api/admin/notifications/[id]', () => {
  let mockSupabase = createMockSupabase();

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

  it('returns 403 when CSRF validation fails', async () => {
    mockCheckCsrfProtection.mockResolvedValueOnce({
      valid: false,
      response: NextResponse.json(
        { error: 'Invalid CSRF token' },
        { status: 403 }
      ),
    });

    const response = await PATCH(createRequest(), {
      params: Promise.resolve({ id: '123e4567-e89b-12d3-a456-426614174000' }),
    });
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe('Invalid CSRF token');
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  it('returns 400 for malformed JSON bodies', async () => {
    const response = await PATCH(
      new Request('http://localhost/api/admin/notifications/123', {
        method: 'PATCH',
        body: '{not-json',
        headers: { 'Content-Type': 'application/json' },
      }) as NextRequest,
      {
        params: Promise.resolve({ id: '123e4567-e89b-12d3-a456-426614174000' }),
      }
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Invalid JSON body');
  });

  it('rejects edits after delivery processing has started', async () => {
    mockSupabase = createMockSupabase({
      notification: {
        delivery_state: 'processing',
        id: '123e4567-e89b-12d3-a456-426614174000',
        sent_at: null,
        target_merchant_ids: null,
        target_segment: null,
        target_type: 'all',
        title: 'Launch update',
      },
    });
    mockCreateClient.mockReturnValue(mockSupabase);

    const response = await PATCH(createRequest(), {
      params: Promise.resolve({ id: '123e4567-e89b-12d3-a456-426614174000' }),
    });

    expect(response.status).toBe(409);
    expect(mockSupabase.__notificationUpdates).toEqual([]);
  });

  it('rejects the update when a notification is sent after the preflight read', async () => {
    mockSupabase = createMockSupabase({ updateReturnsRow: false });
    mockCreateClient.mockReturnValue(mockSupabase);

    const response = await PATCH(createRequest({ title: 'Race-safe update' }), {
      params: Promise.resolve({
        id: '123e4567-e89b-12d3-a456-426614174000',
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error).toBe(
      'Notification delivery has already started or completed'
    );
    expect(mockSupabase.__notificationsQuery.eq).toHaveBeenCalledWith(
      'delivery_state',
      'pending'
    );
    expect(mockSupabase.__notificationsQuery.is).toHaveBeenCalledWith(
      'sent_at',
      null
    );
  });
});
