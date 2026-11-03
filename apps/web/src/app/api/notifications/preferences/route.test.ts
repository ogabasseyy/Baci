import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const existingLookup = vi.hoisted(() => vi.fn());
const upsert = vi.hoisted(() => vi.fn());

vi.mock('next/headers', () => ({ cookies: vi.fn().mockResolvedValue({}) }));
vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: vi.fn().mockResolvedValue({ valid: true }),
}));
vi.mock('@/lib/api-auth', () => ({ hasPermission: vi.fn(() => true) }));
vi.mock('@/lib/get-merchant-for-api-request', () => ({
  getMerchantForApiRequest: vi.fn().mockResolvedValue({ merchantId: 'm1' }),
  toUserAccess: vi.fn(() => ({})),
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }) },
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: existingLookup }),
      }),
      upsert: (...args: unknown[]) => {
        upsert(...args);
        return {
          select: () => ({
            single: async () => ({ data: { ok: 1 }, error: null }),
          }),
        };
      },
    }),
  }),
}));

import { PATCH } from './route';

const patch = (body: unknown) =>
  PATCH(
    new NextRequest('http://localhost/api/notifications/preferences', {
      method: 'PATCH',
      body: JSON.stringify(body),
    })
  );

describe('PATCH /api/notifications/preferences shipment_event_preferences', () => {
  beforeEach(() => vi.clearAllMocks());

  it('merges a partial toggle into the saved toggles', async () => {
    existingLookup.mockResolvedValue({
      data: { shipment_event_preferences: { failed: false } },
      error: null,
    });
    const res = await patch({
      shipment_event_preferences: { out_for_delivery: true },
    });
    expect(res.status).toBe(200);
    expect(upsert.mock.calls[0][0].shipment_event_preferences).toEqual({
      failed: false,
      out_for_delivery: true,
    });
  });

  it('bugfix: aborts instead of wiping saved toggles when the lookup fails', async () => {
    existingLookup.mockResolvedValue({
      data: null,
      error: { message: 'db down' },
    });
    const res = await patch({
      shipment_event_preferences: { delivered: false },
    });
    expect(res.status).toBe(500);
    expect(upsert).not.toHaveBeenCalled();
  });
});
