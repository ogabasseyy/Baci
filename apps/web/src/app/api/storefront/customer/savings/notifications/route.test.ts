import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  csrf: vi.fn(),
  resolve: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('@/lib/api-auth', () => ({ authenticateApiRequest: mocks.auth }));
vi.mock('@/lib/csrf', () => ({ checkCsrfProtection: mocks.csrf }));
vi.mock('@/app/api/storefront/customer/savings/shared', () => ({
  resolveCustomerSavingsContext: mocks.resolve,
}));

import { GET, PATCH } from './route';

const merchantId = '10000000-0000-4000-8000-000000000001';
const notificationId = '20000000-0000-4000-8000-000000000001';
const preferenceSet = {
  encouragementEnabled: true,
  weeklySummaryEnabled: false,
  interestAlertsEnabled: true,
  quietHoursStart: '22:00',
  quietHoursEnd: '07:00',
  timeZone: 'Africa/Lagos',
};
const endpoint = `http://localhost/api/storefront/customer/savings/notifications?merchantId=${merchantId}`;

function patch(body: unknown) {
  return new NextRequest(endpoint, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({
    error: null,
    supabase: { rpc: mocks.rpc },
    user: { id: 'customer-auth-user' },
  });
  mocks.csrf.mockResolvedValue({ valid: true });
  mocks.resolve.mockResolvedValue({
    customer: { id: '30000000-0000-4000-8000-000000000001' },
    merchant: { id: merchantId },
    supabase: { rpc: mocks.rpc },
  });
});

afterEach(() => vi.unstubAllEnvs());

describe('/api/storefront/customer/savings/notifications', () => {
  it('authenticates before resolving context or reading notifications', async () => {
    mocks.auth.mockResolvedValue({
      error: 'Unauthorized',
      user: null,
      supabase: null,
    });
    const response = await GET(new NextRequest(endpoint));
    expect(response.status).toBe(401);
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('returns strictly validated notifications and preferences from the authenticated RPC', async () => {
    vi.stubEnv('SAVINGS_NOTIFICATIONS_ENABLED', 'false');
    mocks.rpc.mockResolvedValue({
      error: null,
      data: {
        notifications: [
          {
            id: notificationId,
            goalId: null,
            type: 'weekly_summary',
            title: 'Your week',
            body: 'A steady week.',
            createdAt: '2026-09-25T12:00:00Z',
            readAt: null,
          },
        ],
        preferences: preferenceSet,
      },
    });
    const response = await GET(new NextRequest(endpoint));
    expect(response.status).toBe(200);
    expect(mocks.resolve).toHaveBeenCalledWith({
      identifiers: { merchantId },
      supabase: expect.any(Object),
      user: { id: 'customer-auth-user' },
    });
    expect(mocks.rpc).toHaveBeenCalledWith(
      'get_customer_savings_notifications',
      {
        p_merchant_id: merchantId,
      }
    );
    expect(mocks.csrf).not.toHaveBeenCalled();
    expect(await response.json()).toEqual({
      notifications: [expect.objectContaining({ id: notificationId })],
      preferences: preferenceSet,
      deliveryEnabled: false,
    });
  });

  it('advertises verified delivery without giving worker credentials to the user-facing API', async () => {
    vi.stubEnv('SAVINGS_NOTIFICATIONS_DELIVERY_ENABLED', 'true');
    vi.stubEnv('SAVINGS_NOTIFICATIONS_DATABASE_URL', undefined);
    vi.stubEnv('SAVINGS_NOTIFICATIONS_DATABASE_NAME', undefined);
    mocks.rpc.mockResolvedValue({
      error: null,
      data: { notifications: [], preferences: preferenceSet },
    });

    const response = await GET(new NextRequest(endpoint));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ deliveryEnabled: true });
  });

  it('keeps delivery disabled until its separate deployment capability is enabled', async () => {
    vi.stubEnv('SAVINGS_NOTIFICATIONS_ENABLED', 'true');
    vi.stubEnv('SAVINGS_NOTIFICATIONS_DELIVERY_ENABLED', undefined);
    vi.stubEnv(
      'SAVINGS_NOTIFICATIONS_DATABASE_URL',
      'postgresql://worker:secret@db.example.test/app'
    );
    vi.stubEnv('SAVINGS_NOTIFICATIONS_DATABASE_NAME', 'app');
    mocks.rpc.mockResolvedValue({
      error: null,
      data: { notifications: [], preferences: preferenceSet },
    });

    const response = await GET(new NextRequest(endpoint));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ deliveryEnabled: false });
  });

  it('validates PATCH input before resolving customer context or writing', async () => {
    const response = await PATCH(
      patch({
        merchantId,
        preferences: {},
      })
    );
    expect(response.status).toBe(400);
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('rejects PATCH without valid CSRF before resolving customer context or writing', async () => {
    mocks.csrf.mockResolvedValue({ valid: false });
    const response = await PATCH(
      patch({ merchantId, readNotificationId: notificationId })
    );
    expect(response.status).toBe(403);
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('requires CSRF validation before the preference RPC and returns success', async () => {
    mocks.rpc.mockResolvedValue({ error: null, data: preferenceSet });
    const response = await PATCH(
      patch({
        merchantId,
        preferences: { weeklySummaryEnabled: true },
      })
    );
    expect(response.status).toBe(200);
    expect(mocks.csrf).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledWith(
      'update_customer_savings_notification_preferences',
      {
        p_merchant_id: merchantId,
        p_preferences: { weeklySummaryEnabled: true },
      }
    );
    expect(await response.json()).toEqual({ success: true });
  });

  it('returns 404 when the read RPC reports that the notification is absent', async () => {
    mocks.rpc.mockResolvedValue({ error: null, data: false });
    const response = await PATCH(
      patch({ merchantId, readNotificationId: notificationId })
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: expect.any(String) });
  });

  it('returns a generic 503 for RPC failures without exposing database details', async () => {
    mocks.rpc.mockResolvedValue({
      error: {
        message: 'missing function secret_database_detail',
        code: '42883',
      },
      data: null,
    });
    const response = await GET(new NextRequest(endpoint));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: 'Savings notifications are temporarily unavailable',
    });
  });

  it('returns 503 when the notification RPC payload fails strict response validation', async () => {
    mocks.rpc.mockResolvedValue({
      error: null,
      data: {
        notifications: [],
        preferences: { ...preferenceSet, timeZone: 'invalid' },
      },
    });
    const response = await GET(new NextRequest(endpoint));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: 'Savings notifications are temporarily unavailable',
    });
  });
});
