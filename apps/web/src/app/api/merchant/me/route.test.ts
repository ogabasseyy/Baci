import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  createServerClient: vi.fn(),
  fetchDashboardMerchantContext: vi.fn(),
  getMerchantForApiRequest: vi.fn(),
  maybeSingle: vi.fn(),
  selectMerchant: vi.fn(),
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({ get: vi.fn(), set: vi.fn() }),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => mocks.createServerClient(),
}));

vi.mock('@/hooks/merchant/fetch-dashboard-merchant-context', () => ({
  fetchDashboardMerchantContext: (...args: unknown[]) =>
    mocks.fetchDashboardMerchantContext(...args),
}));

vi.mock('@/lib/get-merchant-for-api-request', () => ({
  getMerchantForApiRequest: (...args: unknown[]) =>
    mocks.getMerchantForApiRequest(...args),
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

import { GET } from './route';

const SERVER_CLIENT = {
  auth: { getUser: mocks.getUser },
  from: vi.fn(() => ({
    select: mocks.selectMerchant,
  })),
  tag: 'authenticated-server-client',
};

function makeRequest(merchantId?: string): Parameters<typeof GET>[0] {
  return new NextRequest('https://usebaci.com/api/merchant/me', {
    headers: merchantId ? { 'x-baci-merchant-id': merchantId } : undefined,
  });
}

const ownerStaffAccess = {
  isStaff: false,
  isOwner: true,
  role: 'owner',
  permissions: {},
};

describe('GET /api/merchant/me', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createServerClient.mockReturnValue(SERVER_CLIENT);
    mocks.getUser.mockResolvedValue({
      data: { user: { id: 'user-123' } },
      error: null,
    });
    mocks.fetchDashboardMerchantContext.mockResolvedValue({
      merchant: { id: 'merchant-1', business_name: 'Baci Store' },
      primaryDomain: null,
      staffAccess: ownerStaffAccess,
    });
    mocks.maybeSingle.mockResolvedValue({ data: null, error: null });
    mocks.selectMerchant.mockReturnValue({
      eq: vi.fn(() => ({ maybeSingle: mocks.maybeSingle })),
    });
  });

  it('returns 401 when the request is unauthenticated', async () => {
    mocks.getUser.mockResolvedValueOnce({
      data: { user: null },
      error: null,
    });

    const response = await GET(makeRequest());

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Unauthorized' });
    // The no-store/private cache invariant must hold on error paths too.
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(response.headers.get('Cache-Control')).toContain('private');
    expect(mocks.fetchDashboardMerchantContext).not.toHaveBeenCalled();
  });

  it('returns 401 when getUser reports an auth error', async () => {
    mocks.getUser.mockResolvedValueOnce({
      data: { user: null },
      error: new Error('bad jwt'),
    });

    const response = await GET(makeRequest());

    expect(response.status).toBe(401);
    expect(mocks.fetchDashboardMerchantContext).not.toHaveBeenCalled();
  });

  it('resolves the owner merchant via the authenticated server client scoped to the session user', async () => {
    const response = await GET(makeRequest());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      merchant: { id: 'merchant-1', business_name: 'Baci Store' },
      staffAccess: ownerStaffAccess,
    });
    // The RPC receives the authenticated client and no caller-supplied scope.
    expect(mocks.fetchDashboardMerchantContext).toHaveBeenCalledWith(
      SERVER_CLIENT
    );
    // Per-user secret payload must never be cached by a shared cache/CDN.
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(response.headers.get('Cache-Control')).toContain('private');
  });

  it('attaches the primary custom domain when present', async () => {
    mocks.fetchDashboardMerchantContext.mockResolvedValueOnce({
      merchant: { id: 'merchant-1', business_name: 'Baci Store' },
      primaryDomain: 'shop.example.com',
      staffAccess: ownerStaffAccess,
    });

    const response = await GET(makeRequest());
    const body = await response.json();

    expect(body.merchant.custom_domain).toBe('shop.example.com');
  });

  it('returns the staff access payload for an active staff member', async () => {
    const staffAccess = {
      isStaff: true,
      isOwner: false,
      role: 'manager',
      permissions: { settings: { view: true } },
    };
    mocks.fetchDashboardMerchantContext.mockResolvedValueOnce({
      merchant: { id: 'merchant-9' },
      primaryDomain: null,
      staffAccess,
    });

    const response = await GET(makeRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.staffAccess).toEqual(staffAccess);
  });

  it('returns the authoritative merchant and permissions for an allowed selected context', async () => {
    const merchantId = '22222222-2222-4222-8222-222222222222';
    const staffAccess = {
      isStaff: true,
      isOwner: false,
      role: 'marketing',
      permissions: { analytics: { view: true } },
    };
    mocks.getMerchantForApiRequest.mockResolvedValueOnce({
      merchantId,
      staffAccess,
    });
    mocks.maybeSingle.mockResolvedValueOnce({
      data: {
        id: merchantId,
        user_id: 'owner-2',
        business_name: 'Selected Store',
        business_type: 'fashion',
        slug: 'selected-store',
        country: 'GH',
        payout_currency: 'GHS',
      },
      error: null,
    });

    const response = await GET(makeRequest(merchantId));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.getMerchantForApiRequest).toHaveBeenCalledWith(
      SERVER_CLIENT,
      'user-123',
      { requestedMerchantId: merchantId }
    );
    expect(body).toMatchObject({
      merchant: { country: 'GH', id: merchantId, payout_currency: 'GHS' },
      staffAccess,
    });
    expect(mocks.selectMerchant).toHaveBeenCalledWith(
      'id, user_id, business_name, business_type, slug, country, payout_currency'
    );
    expect(mocks.fetchDashboardMerchantContext).not.toHaveBeenCalled();
    expect(response.headers.get('Cache-Control')).toContain('no-store');
  });

  it('does not disclose a selected merchant the caller cannot access', async () => {
    const merchantId = '33333333-3333-4333-8333-333333333333';
    mocks.getMerchantForApiRequest.mockResolvedValueOnce(null);

    const response = await GET(makeRequest(merchantId));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Merchant not found' });
    expect(SERVER_CLIENT.from).not.toHaveBeenCalled();
    expect(mocks.fetchDashboardMerchantContext).not.toHaveBeenCalled();
  });

  it('returns a null merchant (not an error) when the user has no dashboard merchant', async () => {
    mocks.fetchDashboardMerchantContext.mockResolvedValueOnce({
      merchant: null,
      primaryDomain: null,
      staffAccess: {
        isStaff: false,
        isOwner: false,
        role: null,
        permissions: {},
      },
    });

    const response = await GET(makeRequest());

    expect(response.status).toBe(200);
    expect((await response.json()).merchant).toBeNull();
  });

  it('returns 500 when the dashboard lookup throws', async () => {
    mocks.fetchDashboardMerchantContext.mockRejectedValueOnce(
      new Error('db down')
    );

    const response = await GET(makeRequest());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Internal server error' });
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(response.headers.get('Cache-Control')).toContain('private');
  });
});
