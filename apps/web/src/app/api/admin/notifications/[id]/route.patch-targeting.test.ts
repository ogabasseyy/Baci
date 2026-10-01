import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PATCH } from './route';

const mockCreateClient = vi.fn();
const mockAuthorizeNotificationAdmin = vi.fn();
const mockCheckCsrfProtection = vi.fn();

vi.mock('@/lib/admin-notification-auth', () => ({
  authorizeNotificationAdmin: () => mockAuthorizeNotificationAdmin(),
}));

vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: (...args: unknown[]) => mockCheckCsrfProtection(...args),
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn() },
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: (...args: unknown[]) => mockCreateClient(...args),
}));

const notificationId = '123e4567-e89b-12d3-a456-426614174000';
const merchantId = '123e4567-e89b-12d3-a456-426614174111';

function createRequest(body: Record<string, unknown>) {
  return new Request(
    `http://localhost/api/admin/notifications/${notificationId}`,
    {
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
      method: 'PATCH',
    }
  ) as NextRequest;
}

function createMockSupabase(options?: {
  targetMerchantIds?: string[] | null;
  targetType?: 'all' | 'specific';
  updatedNotification?: Record<string, unknown>;
}) {
  const notification = {
    delivery_state: 'pending',
    id: notificationId,
    sent_at: null,
    target_merchant_ids: options?.targetMerchantIds ?? [merchantId],
    target_segment: null,
    target_type: options?.targetType ?? 'specific',
    title: 'Launch update',
  };
  const updates: Record<string, unknown>[] = [];
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
      data: options?.updatedNotification ?? notification,
      error: null,
    })),
    single: vi.fn(async () => ({ data: notification, error: null })),
    select: vi.fn(() => notificationsQuery),
    update: vi.fn((payload: Record<string, unknown>) => {
      updates.push(payload);
      return notificationsQuery;
    }),
  };
  return {
    updates,
    from: vi.fn((table: string) => {
      if (table === 'merchants') return merchantsQuery;
      if (table === 'notifications') return notificationsQuery;
      throw new Error(`Unexpected table: ${table}`);
    }),
    rpc: vi.fn(() => Promise.resolve({ data: [merchantId], error: null })),
  };
}

describe('PATCH /api/admin/notifications/[id] targeting', () => {
  let supabase = createMockSupabase();

  beforeEach(() => {
    vi.clearAllMocks();
    supabase = createMockSupabase();
    mockCreateClient.mockReturnValue(supabase);
    mockAuthorizeNotificationAdmin.mockResolvedValue({
      status: 'authorized',
      userId: 'user-1',
    });
    mockCheckCsrfProtection.mockResolvedValue({ valid: true });
  });

  it('rejects updates that would leave specific targeting without merchants', async () => {
    const response = await PATCH(createRequest({ target_merchant_ids: [] }), {
      params: Promise.resolve({ id: notificationId }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      details: {
        fieldErrors: {
          target_merchant_ids: [
            'Target merchant IDs required for specific targeting',
          ],
        },
      },
      error: 'Invalid input',
    });
  });

  it('requires explicit merchant IDs when retargeting a specific audience', async () => {
    const response = await PATCH(createRequest({ target_type: 'specific' }), {
      params: Promise.resolve({ id: notificationId }),
    });

    expect(response.status).toBe(400);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('allows all-target notifications to clear stored merchant IDs with null', async () => {
    supabase = createMockSupabase({
      updatedNotification: {
        id: notificationId,
        sent_at: null,
        target_merchant_ids: null,
        target_segment: null,
        target_type: 'all',
        title: 'Launch update',
      },
    });
    mockCreateClient.mockReturnValue(supabase);

    const response = await PATCH(
      createRequest({ target_type: 'all', target_merchant_ids: null }),
      { params: Promise.resolve({ id: notificationId }) }
    );

    expect(response.status).toBe(200);
    expect(supabase.updates.at(-1)).toMatchObject({
      target_merchant_ids: null,
      target_type: 'all',
    });
  });

  it('rejects clearing merchant IDs when effective targeting remains specific', async () => {
    const response = await PATCH(createRequest({ target_merchant_ids: null }), {
      params: Promise.resolve({ id: notificationId }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      details: {
        fieldErrors: {
          target_merchant_ids: [
            'Target merchant IDs required for specific targeting',
          ],
        },
      },
      error: 'Invalid input',
    });
  });
});
