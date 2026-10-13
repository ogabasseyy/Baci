import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { checkCsrfProtection } from '@/lib/csrf';
import { createClient } from '@/lib/supabase/server';
import { GET, PATCH } from './route';

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

describe('PATCH /api/notifications/preferences', () => {
  let authUser: { id: string } | null;
  let preferenceQuery: {
    eq: ReturnType<typeof vi.fn>;
    select: ReturnType<typeof vi.fn>;
    single: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
  };

  const request = (body: unknown) =>
    new NextRequest('http://localhost/api/notifications/preferences', {
      method: 'PATCH',
      body: JSON.stringify(body),
    });

  beforeEach(() => {
    vi.clearAllMocks();
    authUser = { id: USER_ID };
    preferenceQuery = {
      eq: vi.fn(),
      select: vi.fn(),
      single: vi.fn().mockResolvedValue({
        data: { merchant_id: MERCHANT_ID, in_app_enabled: false },
        error: null,
      }),
      upsert: vi.fn(),
    };
    preferenceQuery.eq.mockReturnValue(preferenceQuery);
    preferenceQuery.select.mockReturnValue(preferenceQuery);
    preferenceQuery.upsert.mockReturnValue(preferenceQuery);
    vi.mocked(checkCsrfProtection).mockResolvedValue({ valid: true });
    vi.mocked(createClient).mockReturnValue({
      auth: {
        getUser: vi.fn(() => Promise.resolve({ data: { user: authUser } })),
      },
      from: vi.fn(() => preferenceQuery),
    } as unknown as ReturnType<typeof createClient>);
  });

  it('returns 401 before checking CSRF when unauthenticated', async () => {
    authUser = null;

    const response = await PATCH(request({ in_app_enabled: false }));

    expect(response.status).toBe(401);
    expect(checkCsrfProtection).not.toHaveBeenCalled();
  });

  it('uses an explicit result projection after a validated preference update', async () => {
    const response = await PATCH(request({ in_app_enabled: false }));

    expect(response.status).toBe(200);
    expect(preferenceQuery.upsert).toHaveBeenCalledWith(
      { merchant_id: MERCHANT_ID, in_app_enabled: false },
      { onConflict: 'merchant_id' }
    );
    expect(preferenceQuery.select).toHaveBeenCalledWith(
      expect.stringContaining('quiet_hours_end')
    );
  });

  it('returns the stored follow-up alert preference', async () => {
    preferenceQuery.single.mockResolvedValueOnce({
      data: {
        merchant_id: MERCHANT_ID,
        follow_up_notifications_enabled: false,
      },
      error: null,
    });

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      follow_up_notifications_enabled: false,
    });
    expect(preferenceQuery.select).toHaveBeenCalledWith(
      expect.stringContaining('follow_up_notifications_enabled')
    );
  });

  it('defaults follow-up alerts on when a merchant has no preference row', async () => {
    preferenceQuery.single.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST116', message: 'No rows found' },
    });

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      merchant_id: MERCHANT_ID,
      follow_up_notifications_enabled: true,
    });
  });

  it('persists the follow-up alert toggle', async () => {
    const response = await PATCH(
      request({ follow_up_notifications_enabled: false })
    );

    expect(response.status).toBe(200);
    expect(preferenceQuery.upsert).toHaveBeenCalledWith(
      {
        merchant_id: MERCHANT_ID,
        follow_up_notifications_enabled: false,
      },
      { onConflict: 'merchant_id' }
    );
  });

  it('rejects a non-boolean follow-up alert toggle', async () => {
    const response = await PATCH(
      request({ follow_up_notifications_enabled: 'off' })
    );

    expect(response.status).toBe(400);
    expect(preferenceQuery.upsert).not.toHaveBeenCalled();
  });

  it('rejects an unknown preference field', async () => {
    const response = await PATCH(request({ administrator_only: true }));

    expect(response.status).toBe(400);
    expect(preferenceQuery.upsert).not.toHaveBeenCalled();
  });

  it('persists a valid IANA timezone for quiet hours', async () => {
    const response = await PATCH(
      request({ quiet_hours_time_zone: 'America/New_York' })
    );

    expect(response.status).toBe(200);
    expect(preferenceQuery.upsert).toHaveBeenCalledWith(
      { merchant_id: MERCHANT_ID, quiet_hours_time_zone: 'America/New_York' },
      { onConflict: 'merchant_id' }
    );
  });

  it('returns form-level validation details for an empty update', async () => {
    const response = await PATCH(request({}));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      details: {
        formErrors: ['At least one preference must be updated'],
      },
      error: 'Invalid request',
    });
    expect(preferenceQuery.upsert).not.toHaveBeenCalled();
  });
});
