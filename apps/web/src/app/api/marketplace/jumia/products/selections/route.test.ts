import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockAuthenticate = vi.fn();
const mockGetUserAccess = vi.fn();
const mockHasPermission = vi.fn();
const mockGetMerchant = vi.fn();
const mockFeatureGate = vi.fn();
const mockCsrf = vi.fn();
const mockRpc = vi.fn();

vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: (...args: unknown[]) => mockAuthenticate(...args),
  getUserAccess: (...args: unknown[]) => mockGetUserAccess(...args),
  hasPermission: (...args: unknown[]) => mockHasPermission(...args),
}));
vi.mock('@/lib/get-merchant-for-api-request', () => ({
  getMerchantForApiRequest: (...args: unknown[]) => mockGetMerchant(...args),
  toUserAccess: (context: { merchantId: string }) => ({
    merchantId: context.merchantId,
  }),
}));
vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: (...args: unknown[]) => mockCsrf(...args),
}));
vi.mock('@/lib/merchant-feature-gates', () => ({
  requireMerchantFeatureAccess: (...args: unknown[]) =>
    mockFeatureGate(...args),
}));

const { POST } = await import('./route');

const MERCHANT_ID = '00000000-0000-4000-8000-000000000001';
const SELECTED_MERCHANT_ID = '00000000-0000-4000-8000-000000000009';
const CATEGORY_ID = '00000000-0000-4000-8000-000000000002';
const SELECTION_ID = '00000000-0000-4000-8000-000000000003';

function makeSupabase() {
  return { rpc: mockRpc };
}

function setupAuthorizedUser() {
  mockAuthenticate.mockResolvedValue({
    user: { id: 'user-id' },
    supabase: makeSupabase(),
    error: null,
  });
  mockGetUserAccess.mockResolvedValue({ merchantId: MERCHANT_ID });
  mockGetMerchant.mockResolvedValue({ merchantId: MERCHANT_ID });
  mockHasPermission.mockReturnValue(true);
  mockFeatureGate.mockResolvedValue(null);
  mockCsrf.mockResolvedValue({ valid: true });
}

describe('Jumia Gaming selection API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupAuthorizedUser();
  });

  it('creates a frozen Gaming selection without provider calls', async () => {
    mockGetMerchant.mockResolvedValueOnce({ merchantId: SELECTED_MERCHANT_ID });
    mockRpc.mockResolvedValueOnce({
      data: [
        {
          selection_id: SELECTION_ID,
          total: 151,
          captured_at: '2026-10-23T00:00:00Z',
          expires_at: '2026-10-24T00:00:00Z',
        },
      ],
      error: null,
    });

    const created = await POST(
      new NextRequest(
        'http://localhost/api/marketplace/jumia/products/selections',
        {
          method: 'POST',
          body: JSON.stringify({
            sourceCategoryId: CATEGORY_ID,
            merchantId: SELECTED_MERCHANT_ID,
          }),
        }
      )
    );
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({
      selectionId: SELECTION_ID,
      total: 151,
    });
    expect(mockRpc).toHaveBeenNthCalledWith(
      1,
      'create_jumia_product_export_selection',
      {
        p_merchant_id: SELECTED_MERCHANT_ID,
        p_source_category_id: CATEGORY_ID,
      }
    );

    expect(mockFeatureGate).toHaveBeenCalledWith(
      expect.anything(),
      SELECTED_MERCHANT_ID,
      'marketplace_sync'
    );
    expect(mockHasPermission).toHaveBeenCalledWith(
      { merchantId: SELECTED_MERCHANT_ID },
      'integrations',
      'manage'
    );
    expect(mockGetMerchant).toHaveBeenCalledWith(expect.anything(), 'user-id', {
      requestedMerchantId: SELECTED_MERCHANT_ID,
    });
    expect(mockRpc).toHaveBeenCalledOnce();
  });

  it('authenticates before CSRF or database access', async () => {
    mockAuthenticate.mockResolvedValueOnce({
      user: null,
      supabase: null,
      error: new Error('unauthorized'),
    });
    const response = await POST(
      new NextRequest(
        'http://localhost/api/marketplace/jumia/products/selections',
        {
          method: 'POST',
          body: JSON.stringify({
            sourceCategoryId: CATEGORY_ID,
            merchantId: MERCHANT_ID,
          }),
        }
      )
    );
    expect(response.status).toBe(401);
    expect(mockAuthenticate).toHaveBeenCalledOnce();
    expect(mockCsrf).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('rejects CSRF after authentication and before database access', async () => {
    mockCsrf.mockResolvedValueOnce({ valid: false, response: null });
    const response = await POST(
      new NextRequest(
        'http://localhost/api/marketplace/jumia/products/selections',
        {
          method: 'POST',
          body: JSON.stringify({
            sourceCategoryId: CATEGORY_ID,
            merchantId: MERCHANT_ID,
          }),
        }
      )
    );
    expect(response.status).toBe(403);
    expect(mockAuthenticate).toHaveBeenCalledOnce();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('maps an authorization race from the creation RPC to forbidden', async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { code: '42501' },
    });
    const response = await POST(
      new NextRequest(
        'http://localhost/api/marketplace/jumia/products/selections',
        {
          method: 'POST',
          body: JSON.stringify({
            sourceCategoryId: CATEGORY_ID,
            merchantId: MERCHANT_ID,
          }),
        }
      )
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: 'Unable to create Gaming product selection',
    });
  });

  it('rejects malformed selection input before tenant/database work', async () => {
    const response = await POST(
      new NextRequest(
        'http://localhost/api/marketplace/jumia/products/selections',
        {
          method: 'POST',
          body: JSON.stringify({
            sourceCategoryId: 'Gaming',
            merchantId: MERCHANT_ID,
          }),
        }
      )
    );
    expect(response.status).toBe(400);
    expect(mockGetUserAccess).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('fails closed when the snapshot RPC returns a malformed row', async () => {
    mockRpc.mockResolvedValueOnce({
      data: [{ selection_id: 'malformed', total: 'not-a-number' }],
      error: null,
    });
    const response = await POST(
      new NextRequest(
        'http://localhost/api/marketplace/jumia/products/selections',
        {
          method: 'POST',
          body: JSON.stringify({
            sourceCategoryId: CATEGORY_ID,
            merchantId: MERCHANT_ID,
          }),
        }
      )
    );
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: 'Unable to create Gaming product selection',
    });
  });

  it('rejects a merchant not resolved to the authenticated user before feature checks or RPC', async () => {
    mockGetMerchant.mockResolvedValueOnce(null);
    const response = await POST(
      new NextRequest(
        'http://localhost/api/marketplace/jumia/products/selections',
        {
          method: 'POST',
          body: JSON.stringify({
            sourceCategoryId: CATEGORY_ID,
            merchantId: '00000000-0000-4000-8000-000000000099',
          }),
        }
      )
    );
    expect(response.status).toBe(404);
    expect(mockFeatureGate).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();
  });
});
