import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetUser = vi.fn();
const mockGetMerchant = vi.fn();
const mockToUserAccess = vi.fn();
const mockHasPermission = vi.fn();
const mockRequireFeature = vi.fn();
const mockForIntegration = vi.fn();
const mockGetStock = vi.fn();

vi.mock('next/headers', () => ({ cookies: vi.fn().mockResolvedValue({}) }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => ({ auth: { getUser: mockGetUser } })),
}));
vi.mock('@/lib/get-merchant-for-api-request', () => ({
  getMerchantForApiRequest: (...args: unknown[]) => mockGetMerchant(...args),
  toUserAccess: (...args: unknown[]) => mockToUserAccess(...args),
}));
vi.mock('@/lib/api-auth', () => ({
  hasPermission: (...args: unknown[]) => mockHasPermission(...args),
}));
vi.mock('@/lib/merchant-feature-gates', () => ({
  requireMerchantFeatureAccess: (...args: unknown[]) =>
    mockRequireFeature(...args),
}));
vi.mock('@/lib/jumia/client', async () => {
  const { JumiaApiError, jumiaErrorResponse } = await vi.importActual<
    typeof import('@/lib/jumia/helpers')
  >('@/lib/jumia/helpers');
  return {
    JumiaApiError,
    jumiaErrorResponse,
    JumiaClient: {
      forIntegration: (...args: unknown[]) => mockForIntegration(...args),
    },
  };
});
vi.mock('@/lib/jumia/consignment', () => ({
  getConsignmentStock: (...args: unknown[]) => mockGetStock(...args),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));

import { getJumiaConsignmentStock } from './get-jumia-consignment-stock';

const merchantContext = {
  merchantId: '00000000-0000-4000-8000-000000000001',
};
const request = new NextRequest(
  'http://localhost/api/marketplace/jumia/consignment?integrationId=00000000-0000-4000-8000-000000000099&sku=SKU-1&businessClientCode=NG'
);

describe('getJumiaConsignmentStock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    });
    mockGetMerchant.mockResolvedValue(merchantContext);
    mockToUserAccess.mockReturnValue({ role: 'owner' });
    mockHasPermission.mockReturnValue(true);
    mockRequireFeature.mockResolvedValue(null);
    mockForIntegration.mockResolvedValue({ shopId: 'shop-1' });
    mockGetStock.mockResolvedValue({ available: 4 });
  });

  it('returns 403 for view-only staff', async () => {
    mockHasPermission.mockReturnValue(false);
    const response = await getJumiaConsignmentStock(request);
    expect(response.status).toBe(403);
    expect(mockForIntegration).not.toHaveBeenCalled();
  });

  it('allows a manage-authorized caller to retrieve stock', async () => {
    const response = await getJumiaConsignmentStock(request);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ available: 4 });
    expect(mockGetStock).toHaveBeenCalledWith(
      { shopId: 'shop-1' },
      'NG',
      'SKU-1'
    );
  });
});
