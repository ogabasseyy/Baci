import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  mockAuthorizeNotificationAdmin: vi.fn(),
  mockCheckCsrfProtection: vi.fn(),
  mockFrom: vi.fn(),
  mockLoggerError: vi.fn(),
  mockNotificationInsert: vi.fn(),
  mockNotificationSelect: vi.fn(),
  mockRpc: vi.fn(),
}));

vi.mock('@/lib/admin-notification-auth', () => ({
  authorizeNotificationAdmin: mocks.mockAuthorizeNotificationAdmin,
}));

vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: mocks.mockCheckCsrfProtection,
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: mocks.mockLoggerError, info: vi.fn(), warn: vi.fn() },
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => ({ from: mocks.mockFrom, rpc: mocks.mockRpc })),
}));

import { POST } from './route';

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

function createRequest(body: Record<string, unknown> = {}) {
  return new NextRequest('https://usebaci.com/api/admin/notifications', {
    body: JSON.stringify({
      channels: ['in_app'],
      message: 'This is a test notification',
      notification_type: 'info',
      priority: 'high',
      target_segment: 'new',
      target_type: 'segment',
      title: 'Test Notification',
      ...body,
    }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  });
}

function mockSupabaseTables() {
  mocks.mockFrom.mockImplementation((table: string) => {
    if (table !== 'notifications')
      throw new Error(`Unexpected table: ${table}`);
    return {
      insert: mocks.mockNotificationInsert.mockImplementation((values) => ({
        select: mocks.mockNotificationSelect.mockImplementation(() => ({
          single: vi.fn().mockResolvedValue({
            data: { ...notification, scheduled_for: values.scheduled_for },
            error: null,
          }),
        })),
      })),
    };
  });
}

describe('POST /api/admin/notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockAuthorizeNotificationAdmin.mockResolvedValue({
      status: 'authorized',
      userId: 'user-1',
    });
    mocks.mockCheckCsrfProtection.mockResolvedValue({ valid: true });
    mockSupabaseTables();
  });

  it('authenticates before CSRF validation or request processing', async () => {
    mocks.mockAuthorizeNotificationAdmin.mockResolvedValue({
      response: new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
      }),
      status: 'error',
    });

    const response = await POST(createRequest());

    expect(response.status).toBe(401);
    expect(mocks.mockCheckCsrfProtection).not.toHaveBeenCalled();
    expect(mocks.mockNotificationInsert).not.toHaveBeenCalled();
  });

  it('rejects an invalid CSRF token before creating a notification', async () => {
    mocks.mockCheckCsrfProtection.mockResolvedValue({
      response: null,
      valid: false,
    });

    const response = await POST(createRequest());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: 'CSRF validation failed',
    });
    expect(mocks.mockNotificationInsert).not.toHaveBeenCalled();
  });

  it('queues an immediate segment notification without resolving recipients or sending push', async () => {
    const before = Date.now();

    const response = await POST(createRequest());
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toMatchObject({
      notification: expect.objectContaining({
        delivery_state: 'pending',
        sent_at: null,
      }),
      status: 'queued',
    });
    expect(new Date(body.scheduled_for).getTime()).toBeGreaterThanOrEqual(
      before
    );
    expect(mocks.mockNotificationInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        scheduled_for: expect.any(String),
      })
    );
    expect(mocks.mockNotificationSelect).toHaveBeenCalledWith(
      expect.stringContaining('delivery_state')
    );
    expect(mocks.mockRpc).not.toHaveBeenCalled();
  });

  it('keeps a future notification pending and reports it as scheduled', async () => {
    const scheduledFor = '2026-12-01T09:30:00.000Z';

    const response = await POST(createRequest({ scheduled_for: scheduledFor }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toMatchObject({
      scheduled_for: scheduledFor,
      status: 'scheduled',
    });
    expect(mocks.mockNotificationInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        scheduled_for: scheduledFor,
      })
    );
  });

  it('rejects an unknown specific target through the target resolver RPC', async () => {
    const targetId = '123e4567-e89b-12d3-a456-426614174111';
    mocks.mockRpc.mockResolvedValue({ data: [], error: null });

    const response = await POST(
      createRequest({
        target_merchant_ids: [targetId],
        target_type: 'specific',
      })
    );

    expect(response.status).toBe(400);
    expect(mocks.mockRpc).toHaveBeenCalledWith(
      'resolve_admin_notification_target_merchant_ids_v1',
      { p_merchant_ids: [targetId] }
    );
    expect(mocks.mockNotificationInsert).not.toHaveBeenCalled();
  });
});
