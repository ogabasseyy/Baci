import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  createClient: vi.fn(),
  load: vi.fn(),
}));

vi.mock('@/lib/admin-merchant-360', () => ({
  getAdminMerchant360: (...args: unknown[]) => mocks.load(...args),
}));

vi.mock('@/lib/platform-admin-auth', () => ({
  getPlatformAdminAuthForPermission: (...args: unknown[]) =>
    mocks.auth(...args),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: (...args: unknown[]) => mocks.createClient(...args),
}));

import { GET } from './route';

const merchantId = '11111111-1111-4111-8111-111111111111';
const response = {
  generatedAt: '2026-03-20T10:00:00.000Z',
  merchant: { businessName: 'Redacted Store', id: merchantId },
  staffAccess: [{ role: 'manager', status: 'active', users: 2 }],
  summary: { customerUsers: 101, staffUsers: 2 },
};

function request() {
  return new Request(
    `http://localhost/api/admin/merchants/${merchantId}/users`
  ) as NextRequest;
}

function context(id = merchantId) {
  return { params: Promise.resolve({ merchantId: id }) };
}

describe('GET /api/admin/merchants/[merchantId]/users', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({
      context: { permissions: ['merchants.read'], role: 'support' },
      status: 'authenticated',
      user: { email: 'support@example.com', id: 'support-1' },
    });
    mocks.createClient.mockResolvedValue({ rpc: vi.fn() });
    mocks.load.mockResolvedValue({ data: response, error: null });
  });

  it.each([
    ['unauthenticated', 401, 'Unauthorized'],
    ['forbidden', 403, 'Forbidden'],
  ] as const)('returns the correct boundary for %s callers before parsing or loading', async (status, expectedStatus, expectedError) => {
    mocks.auth.mockResolvedValueOnce({ status });

    const result = await GET(request(), context('not-a-uuid'));

    expect(result.status).toBe(expectedStatus);
    await expect(result.json()).resolves.toEqual({ error: expectedError });
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it('returns 400 for an invalid merchant id after authorization', async () => {
    const result = await GET(request(), context('not-a-uuid'));

    expect(result.status).toBe(400);
    expect((await result.json()).code).toBe('INVALID_MERCHANT_ID');
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it('returns 404 when the target merchant is missing', async () => {
    mocks.load.mockResolvedValueOnce({ data: null, error: null });

    const result = await GET(request(), context());

    expect(result.status).toBe(404);
  });

  it('returns a redacted Merchant 360 snapshot with exact counts', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    const result = await GET(request(), context());
    const body = await result.json();

    expect(mocks.auth).toHaveBeenCalledWith('merchants.read');
    expect(mocks.load).toHaveBeenCalledWith(expect.anything(), merchantId);
    expect(result.status).toBe(200);
    expect(result.headers.get('Cache-Control')).toBe('private, no-store');
    expect(body.summary.customerUsers).toBe(101);
    expect(body).not.toHaveProperty('users.customers');
    expect(body).not.toHaveProperty('directory');
    expect(body).not.toHaveProperty('merchant.email');
    expect(body).not.toHaveProperty('merchant.phone');
    expect(info).toHaveBeenCalledWith('[Admin merchant 360] Snapshot read:', {
      customerCount: 101,
      generatedAt: '2026-03-20T10:00:00.000Z',
      staffCount: 2,
    });
    const [, logPayload] = info.mock.calls[0] ?? [];
    expect(logPayload).not.toHaveProperty('merchantId');
    expect(logPayload).not.toHaveProperty('adminUserId');
    info.mockRestore();
  });

  it('fails without returning partial data when the RPC errors', async () => {
    mocks.load.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST000', message: 'unavailable' },
    });

    const result = await GET(request(), context());

    expect(result.status).toBe(500);
    await expect(result.json()).resolves.toEqual({
      error: 'Failed to fetch merchant operations',
    });
  });
});
