import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  backfill: vi.fn(),
  csrf: vi.fn(),
  getUser: vi.fn(),
  merchant: vi.fn(),
  permission: vi.fn(),
  rate: vi.fn(),
}));

vi.mock('next/headers', () => ({ cookies: async () => ({}) }));
vi.mock('@/lib/csrf', () => ({ checkCsrfProtection: mocks.csrf }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({ auth: { getUser: mocks.getUser } }),
}));
vi.mock('@/lib/get-merchant-for-api-request', () => ({
  getMerchantForApiRequest: mocks.merchant,
  toUserAccess: (value: unknown) => value,
}));
vi.mock('@/lib/api-permissions', () => ({ hasPermission: mocks.permission }));
vi.mock('@/ai/provider', () => ({ checkRateLimit: mocks.rate }));
vi.mock('../../../../../mcp-server/backfill-discovery-batch', () => ({
  backfillDiscoveryBatch: mocks.backfill,
}));

import { POST } from './route';

const merchantId = '11111111-1111-4111-8111-111111111111';
const request = (body: string) =>
  new NextRequest('https://usebaci.com/api/products/discovery-backfill', {
    method: 'POST',
    body,
    headers: { 'Content-Type': 'application/json' },
  });

describe('merchant discovery backfill API', () => {
  afterEach(() => vi.unstubAllEnvs());
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('GEMINI_API_KEY', 'private-test-key');
    mocks.csrf.mockResolvedValue({ valid: true, response: null });
    mocks.getUser.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    });
    mocks.merchant.mockResolvedValue({ merchantId, merchantSlug: 'ogabassey' });
    mocks.permission.mockReturnValue(true);
    mocks.rate.mockReturnValue({ allowed: true });
    mocks.backfill.mockResolvedValue({
      scanned: 1,
      generated: 1,
      nextCursor: null,
      done: true,
    });
  });

  it('uses the authenticated merchant and never accepts a body-selected tenant', async () => {
    const response = await POST(
      request(JSON.stringify({ merchantId, cursor: null }))
    );
    expect(response.status).toBe(200);
    expect(mocks.merchant).toHaveBeenCalledWith(expect.anything(), 'user-1', {
      requestedMerchantId: merchantId,
    });
    expect(mocks.backfill).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantId,
        geminiKey: 'private-test-key',
        cursor: null,
      })
    );
    expect((await response.json()).generated).toBe(1);
  });

  it('rejects unauthenticated, unauthorized, other-merchant, and malformed requests', async () => {
    mocks.getUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    expect(
      (await POST(request(JSON.stringify({ merchantId, cursor: null })))).status
    ).toBe(401);
    mocks.merchant.mockResolvedValueOnce(null);
    expect(
      (await POST(request(JSON.stringify({ merchantId, cursor: null })))).status
    ).toBe(404);
    mocks.merchant.mockResolvedValueOnce({ merchantId, merchantSlug: 'other' });
    expect(
      (await POST(request(JSON.stringify({ merchantId, cursor: null })))).status
    ).toBe(404);
    mocks.permission.mockReturnValueOnce(false);
    expect(
      (await POST(request(JSON.stringify({ merchantId, cursor: null })))).status
    ).toBe(403);
    expect((await POST(request('{'))).status).toBe(400);
    expect(
      (await POST(request(JSON.stringify({ merchantId, cursor: 'bad' }))))
        .status
    ).toBe(400);
    expect(mocks.backfill).not.toHaveBeenCalled();
  });

  it('fails closed on CSRF and limits repeated provider work', async () => {
    mocks.csrf.mockResolvedValueOnce({ valid: false, response: null });
    expect(
      (await POST(request(JSON.stringify({ merchantId, cursor: null })))).status
    ).toBe(403);
    mocks.rate.mockReturnValueOnce({ allowed: false, resetIn: 1000 });
    expect(
      (await POST(request(JSON.stringify({ merchantId, cursor: null })))).status
    ).toBe(429);
    expect(mocks.backfill).not.toHaveBeenCalled();
  });

  it('does not call Gemini when the server key is missing and hides batch errors', async () => {
    vi.stubEnv('GEMINI_API_KEY', '');
    expect(
      (await POST(request(JSON.stringify({ merchantId, cursor: null })))).status
    ).toBe(503);
    expect(mocks.backfill).not.toHaveBeenCalled();
    vi.stubEnv('GEMINI_API_KEY', 'private-test-key');
    mocks.backfill.mockRejectedValueOnce(new Error('private provider failure'));
    const response = await POST(
      request(JSON.stringify({ merchantId, cursor: null }))
    );
    expect(response.status).toBe(502);
    expect(JSON.stringify(await response.json())).not.toContain(
      'private provider failure'
    );
  });
});
