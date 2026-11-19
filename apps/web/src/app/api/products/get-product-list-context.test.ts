import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getMerchantForApiRequest: vi.fn(),
  getUser: vi.fn(),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ get: vi.fn(), set: vi.fn() }),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({ auth: { getUser: mocks.getUser } }),
}));

vi.mock('@/lib/get-merchant-for-api-request', async (importOriginal) => {
  const actual =
    (await importOriginal()) as typeof import('@/lib/get-merchant-for-api-request');
  return {
    ...actual,
    getMerchantForApiRequest: mocks.getMerchantForApiRequest,
  };
});

import { getProductListContext } from './get-product-list-context';

describe('getProductListContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUser.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    });
    mocks.getMerchantForApiRequest.mockResolvedValue({
      merchantId: 'merchant-b',
      staffAccess: {
        isStaff: false,
        isOwner: true,
        role: null,
        permissions: { full_access: { all: true } },
      },
    });
  });

  it('authorizes the requested merchant before loading embedded product ids', async () => {
    const request = new NextRequest(
      'http://localhost:3000/api/products?ids=product-b&merchantId=merchant-b'
    );

    const result = await getProductListContext(request);

    expect('response' in result).toBe(false);
    if (!('response' in result)) {
      expect(result.canViewProductCosts).toBe(true);
    }
    expect(mocks.getMerchantForApiRequest).toHaveBeenCalledWith(
      expect.anything(),
      'user-1',
      { requestedMerchantId: 'merchant-b' }
    );
  });

  it('marks canViewProductCosts false when staff lacks products:view', async () => {
    mocks.getMerchantForApiRequest.mockResolvedValue({
      merchantId: 'merchant-b',
      staffAccess: {
        isStaff: true,
        isOwner: false,
        role: 'marketing',
        permissions: { marketing: { view: true } },
      },
    });
    const request = new NextRequest(
      'http://localhost:3000/api/products?ids=product-b&merchantId=merchant-b'
    );

    const result = await getProductListContext(request);

    expect('response' in result).toBe(false);
    if (!('response' in result)) {
      expect(result.canViewProductCosts).toBe(false);
    }
  });
});
