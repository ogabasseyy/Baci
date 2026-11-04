import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { checkCsrfProtection } from '@/lib/csrf';
import { createClient } from '@/lib/supabase/server';
import { PATCH } from './route';

const MERCHANT_ID = '123e4567-e89b-12d3-a456-426614174001';
const USER_ID = '123e4567-e89b-12d3-a456-426614174002';

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ get: vi.fn(), set: vi.fn() }),
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/csrf', () => ({ checkCsrfProtection: vi.fn() }));
vi.mock('@/lib/api-auth', () => ({ hasPermission: vi.fn(() => true) }));
vi.mock('@/lib/get-merchant-for-api-request', () => ({
  getMerchantForApiRequest: vi.fn().mockResolvedValue({
    merchantId: '123e4567-e89b-12d3-a456-426614174001',
    staffAccess: {},
  }),
  toUserAccess: vi.fn(() => ({ role: 'owner' })),
}));

describe('PATCH /api/notifications/preferences shipment_event_preferences', () => {
  const rpc = vi.fn();
  const upsert = vi.fn();

  const request = (body: unknown) =>
    new NextRequest('http://localhost/api/notifications/preferences', {
      method: 'PATCH',
      body: JSON.stringify(body),
    });

  beforeEach(() => {
    vi.clearAllMocks();
    const query = {
      upsert: (...args: unknown[]) => {
        upsert(...args);
        return query;
      },
      select: () => query,
      single: async () => ({ data: { merchant_id: MERCHANT_ID }, error: null }),
    };
    vi.mocked(checkCsrfProtection).mockResolvedValue({ valid: true });
    vi.mocked(createClient).mockReturnValue({
      auth: {
        getUser: vi.fn(() =>
          Promise.resolve({ data: { user: { id: USER_ID } } })
        ),
      },
      from: vi.fn(() => query),
      rpc,
    } as unknown as ReturnType<typeof createClient>);
  });

  it('merges a partial toggle atomically in SQL and returns the row without the owner-only upsert', async () => {
    const row = {
      merchant_id: MERCHANT_ID,
      shipment_event_preferences: { out_for_delivery: true },
    };
    rpc.mockResolvedValue({ data: row, error: null });

    const response = await PATCH(
      request({ shipment_event_preferences: { out_for_delivery: true } })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(row);
    expect(rpc).toHaveBeenCalledWith('merge_shipment_event_preferences', {
      p_merchant_id: MERCHANT_ID,
      p_patch: { out_for_delivery: true },
      p_fields: {},
    });
    expect(upsert).not.toHaveBeenCalled();
  });

  it('saves ordinary fields and toggles in the same atomic RPC call', async () => {
    rpc.mockResolvedValue({ data: { merchant_id: MERCHANT_ID }, error: null });

    const response = await PATCH(
      request({
        in_app_enabled: false,
        shipment_event_preferences: { delivered: false },
      })
    );

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('merge_shipment_event_preferences', {
      p_merchant_id: MERCHANT_ID,
      p_patch: { delivered: false },
      p_fields: { in_app_enabled: false },
    });
    expect(upsert).not.toHaveBeenCalled();
  });

  it('bugfix: a failing combined save persists nothing (no separate upsert)', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'db down' } });

    const response = await PATCH(
      request({
        in_app_enabled: false,
        shipment_event_preferences: { delivered: false },
      })
    );

    expect(response.status).toBe(500);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('bugfix: aborts instead of wiping saved toggles when the merge fails', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'db down' } });

    const response = await PATCH(
      request({ shipment_event_preferences: { delivered: false } })
    );

    expect(response.status).toBe(500);
    expect(upsert).not.toHaveBeenCalled();
  });
});
