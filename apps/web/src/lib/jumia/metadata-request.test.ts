import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as getAttributes } from '@/app/api/marketplace/jumia/attribute-sets/[attributeSetId]/route';
import { GET as getBrands } from '@/app/api/marketplace/jumia/brands/route';
import { GET as getCategories } from '@/app/api/marketplace/jumia/categories/route';
import { GET as getDestinations } from '@/app/api/marketplace/jumia/destination-context/route';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  merchant: vi.fn(),
  permission: vi.fn(),
  exact: vi.fn(),
  legacy: vi.fn(),
}));
vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: mocks.auth,
  hasPermission: mocks.permission,
}));
vi.mock('@/lib/get-merchant-for-api-request', () => ({
  getMerchantForApiRequest: mocks.merchant,
  toUserAccess: (value: unknown) => value,
}));
vi.mock('@/lib/jumia/client', () => ({
  JumiaClient: { forIntegration: mocks.exact, forMerchant: mocks.legacy },
}));

import { authorizeJumiaMetadata } from './metadata-request';

const merchantId = '11111111-1111-4111-8111-111111111111';
const integrationId = '22222222-2222-4222-8222-222222222222';
const supabase = {};
const request = (
  query = `merchantId=${merchantId}&integrationId=${integrationId}`
) => new NextRequest(`http://localhost/api?${query}`);
describe('authorizeJumiaMetadata', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ user: { id: 'user' }, supabase });
    mocks.merchant.mockResolvedValue({ merchantId });
    mocks.permission.mockReturnValue(true);
    mocks.exact.mockResolvedValue({ shopId: 'shop' });
    mocks.legacy.mockResolvedValue({ shopId: 'legacy' });
  });
  it('resolves the explicit merchant before loading the exact integration', async () => {
    const result = await authorizeJumiaMetadata(request(), true);
    expect(result).toEqual({ client: { shopId: 'shop' } });
    expect(mocks.merchant).toHaveBeenCalledWith(supabase, 'user', {
      requestedMerchantId: merchantId,
    });
    expect(mocks.exact).toHaveBeenCalledWith(
      supabase,
      merchantId,
      integrationId
    );
    expect(mocks.legacy).not.toHaveBeenCalled();
  });
  it('returns the validated attribute SID after authenticating and resolving path params', async () => {
    const result = await authorizeJumiaMetadata(
      request(),
      true,
      Promise.resolve({ attributeSetId: merchantId })
    );
    expect(result).toEqual({
      client: { shopId: 'shop' },
      attributeSetId: merchantId,
    });
    expect(mocks.auth).toHaveBeenCalledTimes(1);
  });
  it.each([
    'merchantId=nope',
    `merchantId=${merchantId}&integrationId=nope`,
    `merchantId=${merchantId}`,
  ])('rejects invalid exact queries: %s', async (query) => {
    const result = await authorizeJumiaMetadata(request(query), true);
    expect('response' in result && result.response.status).toBe(400);
    expect(mocks.merchant).not.toHaveBeenCalled();
  });
  it('authenticates before tenant reads', async () => {
    mocks.auth.mockResolvedValue({ user: null });
    const result = await authorizeJumiaMetadata(request(), true);
    expect('response' in result && result.response.status).toBe(401);
    expect(mocks.merchant).not.toHaveBeenCalled();
  });
  it.each([
    ['categories', getCategories],
    ['brands', getBrands],
    ['destination-context', getDestinations],
    [
      'attribute-sets',
      (input: NextRequest) =>
        getAttributes(input, {
          params: Promise.resolve({ attributeSetId: 'wrong' }),
        }),
    ],
  ])('returns 401 before malformed metadata validation through the %s route', async (_name, handler) => {
    mocks.auth.mockResolvedValue({ user: null });
    const response = await handler(
      request('merchantId=wrong&integrationId=wrong')
    );
    expect(response.status).toBe(401);
    expect(mocks.merchant).not.toHaveBeenCalled();
    expect(mocks.exact).not.toHaveBeenCalled();
  });
  it.each([
    ['categories', getCategories],
    ['brands', getBrands],
    ['destination-context', getDestinations],
    [
      'attribute-sets',
      (input: NextRequest) =>
        getAttributes(input, {
          params: Promise.resolve({ attributeSetId: merchantId }),
        }),
    ],
  ])('returns 400 for authenticated malformed queries through the %s route without business reads', async (_name, handler) => {
    const response = await handler(
      request('merchantId=wrong&integrationId=wrong')
    );
    expect(response.status).toBe(400);
    expect(mocks.merchant).not.toHaveBeenCalled();
    expect(mocks.exact).not.toHaveBeenCalled();
  });
  it.each([
    'merchantId=wrong',
    '',
    `merchantId=${merchantId}&integrationId=wrong`,
  ])('authenticates before reporting malformed protected queries: %s', async (query) => {
    mocks.auth.mockResolvedValue({ user: null });
    const result = await authorizeJumiaMetadata(request(query), true);
    expect('response' in result && result.response.status).toBe(401);
    expect(mocks.merchant).not.toHaveBeenCalled();
    expect(mocks.exact).not.toHaveBeenCalled();
  });
  it('authenticates before reporting a malformed attribute set path', async () => {
    mocks.auth.mockResolvedValue({ user: null });
    const result = await authorizeJumiaMetadata(request(), true, {
      attributeSetId: 'wrong',
    });
    expect('response' in result && result.response.status).toBe(401);
    expect(mocks.merchant).not.toHaveBeenCalled();
  });
  it('rejects an authenticated malformed path before any tenant or provider reads', async () => {
    const result = await authorizeJumiaMetadata(request(), true, {
      attributeSetId: 'wrong',
    });
    expect('response' in result && result.response.status).toBe(400);
    expect(mocks.merchant).not.toHaveBeenCalled();
    expect(mocks.exact).not.toHaveBeenCalled();
  });
  it.each([
    null,
    { merchantId: 'other' },
  ])('rejects an unauthorized requested tenant', async (context) => {
    mocks.merchant.mockResolvedValue(context);
    const result = await authorizeJumiaMetadata(request(), true);
    expect('response' in result && result.response.status).toBe(403);
    expect(mocks.exact).not.toHaveBeenCalled();
  });
  it('rejects view-only staff before provider reads', async () => {
    mocks.permission.mockReturnValue(false);
    const result = await authorizeJumiaMetadata(request(), true);
    expect('response' in result && result.response.status).toBe(403);
    expect(mocks.exact).not.toHaveBeenCalled();
  });
  it('retains legacy uniquely-one factory only when integration is omitted', async () => {
    await authorizeJumiaMetadata(request(`merchantId=${merchantId}`), false);
    expect(mocks.legacy).toHaveBeenCalledWith(supabase, merchantId);
    expect(mocks.exact).not.toHaveBeenCalled();
  });
});
