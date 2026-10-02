import { NextRequest } from 'next/server';
import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  merchant: vi.fn(),
  permission: vi.fn(),
  from: vi.fn(),
  eq: vi.fn(),
  gt: vi.fn(),
  result: { data: [] as unknown[], error: null as unknown },
}));
vi.mock('next/headers', () => ({ cookies: async () => ({}) }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({ auth: { getUser: mocks.user }, from: mocks.from }),
}));
vi.mock('@/lib/get-merchant-for-api-request', () => ({
  getMerchantForApiRequest: mocks.merchant,
  toUserAccess: (v: unknown) => v,
}));
vi.mock('@/lib/api-permissions', () => ({ hasPermission: mocks.permission }));

import { GET } from './route';

const request = (suffix = '') =>
  new NextRequest(
    `https://ogabassey.com/api/products/discovery-metadata${suffix}`
  );
beforeEach(() => {
  vi.clearAllMocks();
  mocks.result = { data: [], error: null };
  mocks.user.mockResolvedValue({ data: { user: { id: 'user' } }, error: null });
  mocks.merchant.mockResolvedValue({ merchantId: 'merchant' });
  mocks.permission.mockReturnValue(true);
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: mocks.eq,
    gt: mocks.gt,
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    // biome-ignore lint/suspicious/noThenProperty: Supabase query builders are intentionally thenable.
    then: (resolve: (v: unknown) => void) => resolve(mocks.result),
  };
  mocks.eq.mockReturnValue(query);
  mocks.gt.mockReturnValue(query);
  mocks.from.mockReturnValue(query);
});
it('authenticates and checks edit permission before loading source fields', async () => {
  mocks.user.mockResolvedValueOnce({ data: { user: null }, error: null });
  expect((await GET(request())).status).toBe(401);
  expect(mocks.from).not.toHaveBeenCalled();
  mocks.permission.mockReturnValue(false);
  expect((await GET(request())).status).toBe(403);
  expect(mocks.from).not.toHaveBeenCalled();
});
it('scopes pagination to merchant and returns a bounded review page with raw snapshot', async () => {
  const cursor = '11111111-1111-4111-8111-111111111111';
  mocks.result.data = Array.from({ length: 21 }, (_, i) => ({
    id: String(i),
    name: 'Phone',
    category: 'Smartphones',
    metadata: {},
    discovery_metadata: null,
    specifications: [],
  }));
  const response = await GET(request(`?cursor=${cursor}`));
  const body = await response.json();
  expect(mocks.eq).toHaveBeenCalledWith('merchant_id', 'merchant');
  expect(mocks.gt).toHaveBeenCalledWith('id', cursor);
  expect(body.products).toHaveLength(20);
  expect(body.nextCursor).toBe('19');
  expect(body.products[0]).toMatchObject({
    draft: { product_type: 'phone' },
    expectedMetadata: null,
  });
  expect(response.headers.get('Cache-Control')).toBe('no-store');
});
it('rejects bad cursors and sanitizes database failures', async () => {
  expect((await GET(request('?cursor=bad'))).status).toBe(400);
  mocks.result.error = { message: 'private database error' };
  const response = await GET(request());
  expect(response.status).toBe(500);
  expect(await response.text()).not.toContain('private database');
});
