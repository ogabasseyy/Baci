import { NextRequest } from 'next/server';
import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  operate: vi.fn(),
  merchant: vi.fn(),
  quota: vi.fn(),
}));
vi.mock('@/lib/cart/legacy-canonical-bridge', () => ({
  LegacyBridgeError: class extends Error {
    constructor(readonly code: string) {
      super('Unavailable');
    }
  },
  openLegacyCanonicalCart: mocks.open,
  operateLegacyCanonicalCart: mocks.operate,
}));
vi.mock('@/lib/cart/merchant-resolution', () => ({
  resolveCartMerchant: mocks.merchant,
  createAnonMerchantFeatureLookup: vi.fn(),
}));
vi.mock('@/lib/cart/request-context', () => ({
  checkCartQuota: mocks.quota,
  readCartJsonBody: async (r: Request) => ({ ok: true, body: await r.json() }),
}));
vi.mock('@/lib/slug-alias-cache', () => ({ getCurrentSlugForAlias: vi.fn() }));
vi.mock('@/lib/supabase/anon', () => ({ createAnonClient: vi.fn(() => ({})) }));
vi.mock('@/lib/rate-limit', () => ({
  getTrustedClientIdentifier: () => 'test-ip',
}));

import { LegacyBridgeError } from '@/lib/cart/legacy-canonical-bridge';
import { POST } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.quota.mockResolvedValue({ allowed: true });
  mocks.merchant.mockResolvedValue({
    ok: true,
    merchant: { id: 'merchant', slug: 'shop' },
  });
  mocks.open.mockResolvedValue({ state: { version: 1 } });
  mocks.operate.mockResolvedValue({
    ok: true,
    state: { version: 2 },
    proof: 'cp1.payload.signature',
    continueUrl: 'https://shop.example/cart#handoff=x',
  });
});
const request = (token: string | null, body: unknown = {}) =>
  new NextRequest('https://shop.example/api/storefront/cart/legacy', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer legacy_mcp_${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
it('rejects missing capability before SQL or body-driven authority', async () => {
  expect((await POST(request(null))).status).toBe(401);
  expect(mocks.open).not.toHaveBeenCalled();
});
it('uses resolved merchant and opaque holder capability rather than body owner fields', async () => {
  const response = await POST(
    request('a'.repeat(64), {
      productId: '11111111-1111-4111-8111-111111111111',
      quantity: 2,
      operationId: 'op',
      expectedVersion: 1,
      handoff: true,
    })
  );
  expect(response.status).toBe(200);
  expect(mocks.open).toHaveBeenCalledWith({
    provider: 'mcp',
    handle: 'a'.repeat(64),
    merchant: { id: 'merchant', slug: 'shop' },
  });
  expect(mocks.operate).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({
      edit: { productId: '11111111-1111-4111-8111-111111111111', quantity: 2 },
      expectedVersion: 1,
      operationId: 'op',
    })
  );
});
it('budgets bridge writes per resolved merchant and legacy token', async () => {
  await POST(request('a'.repeat(64)));
  await POST(request('b'.repeat(64)));
  expect(mocks.quota).toHaveBeenCalledWith({
    merchantId: 'merchant',
    operation: 'legacy_bridge',
    subject: 'a'.repeat(64),
  });
  expect(mocks.quota).toHaveBeenCalledWith({
    merchantId: 'merchant',
    operation: 'legacy_bridge',
    subject: 'b'.repeat(64),
  });
});
it('does not migrate non-enrolled merchants or leak provider errors', async () => {
  mocks.merchant.mockResolvedValueOnce({
    ok: false,
    error: 'merchant_unavailable',
  });
  expect((await POST(request('a'.repeat(64)))).status).toBe(403);
  expect(mocks.open).not.toHaveBeenCalled();
  mocks.open.mockRejectedValueOnce(new Error('private database detail'));
  const response = await POST(request('a'.repeat(64)));
  expect(response.status).toBe(503);
  expect(JSON.stringify(await response.json())).not.toContain(
    'private database'
  );
});
it('returns a canonical conflict without legacy fallback', async () => {
  mocks.operate.mockResolvedValueOnce({
    ok: false,
    code: 'version_conflict',
    state: { version: 3 },
    proof: null,
    continueUrl: null,
  });
  expect((await POST(request('a'.repeat(64)))).status).toBe(409);
});

it.each([
  ['unauthorized', 403],
  ['expired', 404],
])('maps rejected owner authority %s safely', async (code, status) => {
  mocks.open.mockRejectedValueOnce(
    new LegacyBridgeError(code as 'unauthorized' | 'expired')
  );
  const response = await POST(request('a'.repeat(64)));
  expect(response.status).toBe(status);
  expect(mocks.operate).not.toHaveBeenCalled();
});
