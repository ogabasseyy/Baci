import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockAuthenticate = vi.fn();
const mockGetUserAccess = vi.fn();
const mockHasPermission = vi.fn();
const mockFeatureGate = vi.fn();
const mockCsrf = vi.fn();
const mockRpc = vi.fn();

vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: (...args: unknown[]) => mockAuthenticate(...args),
  getUserAccess: (...args: unknown[]) => mockGetUserAccess(...args),
  hasPermission: (...args: unknown[]) => mockHasPermission(...args),
}));
vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: (...args: unknown[]) => mockCsrf(...args),
}));
vi.mock('@/lib/merchant-feature-gates', () => ({
  requireMerchantFeatureAccess: (...args: unknown[]) =>
    mockFeatureGate(...args),
}));

const { POST } = await import('./route');
const { GET } = await import('../eligible/route');

const MERCHANT_ID = '00000000-0000-4000-8000-000000000001';
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
  mockHasPermission.mockReturnValue(true);
  mockFeatureGate.mockResolvedValue(null);
  mockCsrf.mockResolvedValue({ valid: true });
}

describe('Jumia Gaming selection API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupAuthorizedUser();
  });

  it('creates a frozen Gaming selection then reads its bounded page without provider calls', async () => {
    mockRpc
      .mockResolvedValueOnce({
        data: [
          {
            selection_id: SELECTION_ID,
            total: 151,
            captured_at: '2026-10-23T00:00:00Z',
            expires_at: '2026-10-24T00:00:00Z',
          },
        ],
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          selectionId: SELECTION_ID,
          sourceCategoryId: CATEGORY_ID,
          products: [
            {
              id: 'product-id',
              ordinal: 51,
              capturedSourceVersion: 'a'.repeat(64),
              currentSourceVersion: 'b'.repeat(64),
              available: true,
              unavailableReason: null,
              product: { product: { id: 'product-id', name: 'Game' } },
            },
          ],
          total: 151,
          page: 2,
          limit: 50,
          totalPages: 4,
          legacyUnmappedCount: 3,
          capturedAt: '2026-10-23T00:00:00Z',
          expiresAt: '2026-10-24T00:00:00Z',
        },
        error: null,
      });

    const created = await POST(
      new NextRequest(
        'http://localhost/api/marketplace/jumia/products/selections',
        {
          method: 'POST',
          body: JSON.stringify({ sourceCategoryId: CATEGORY_ID }),
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
        p_merchant_id: MERCHANT_ID,
        p_source_category_id: CATEGORY_ID,
      }
    );

    const page = await GET(
      new NextRequest(
        `http://localhost/api/marketplace/jumia/products/eligible?selectionId=${SELECTION_ID}&page=2&limit=50`
      )
    );
    expect(page.status).toBe(200);
    expect(await page.json()).toMatchObject({
      selectionId: SELECTION_ID,
      total: 151,
      page: 2,
      legacyUnmappedCount: 3,
      products: [{ ordinal: 51, available: true }],
    });
    expect(mockRpc).toHaveBeenNthCalledWith(
      2,
      'get_jumia_product_export_selection_page',
      {
        p_selection_id: SELECTION_ID,
        p_page: 2,
        p_limit: 50,
      }
    );
    expect(mockFeatureGate).toHaveBeenCalledTimes(2);
    expect(mockRpc).toHaveBeenCalledTimes(2);
  });

  it('rejects CSRF before authentication or database access', async () => {
    mockCsrf.mockResolvedValueOnce({ valid: false, response: null });
    const response = await POST(
      new NextRequest(
        'http://localhost/api/marketplace/jumia/products/selections',
        {
          method: 'POST',
          body: JSON.stringify({ sourceCategoryId: CATEGORY_ID }),
        }
      )
    );
    expect(response.status).toBe(403);
    expect(mockAuthenticate).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('rejects malformed selection input before tenant/database work', async () => {
    const response = await POST(
      new NextRequest(
        'http://localhost/api/marketplace/jumia/products/selections',
        {
          method: 'POST',
          body: JSON.stringify({ sourceCategoryId: 'Gaming' }),
        }
      )
    );
    expect(response.status).toBe(400);
    expect(mockGetUserAccess).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('authenticates eligible queries before returning query validation errors', async () => {
    mockAuthenticate.mockResolvedValueOnce({
      user: null,
      supabase: null,
      error: new Error('unauthorized'),
    });

    const response = await GET(
      new NextRequest(
        'http://localhost/api/marketplace/jumia/products/eligible?selectionId=invalid'
      )
    );

    expect(response.status).toBe(401);
    expect(mockAuthenticate).toHaveBeenCalledOnce();
    expect(mockGetUserAccess).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('requires integrations.manage and marketplace_sync for discovery', async () => {
    mockHasPermission.mockReturnValueOnce(false);
    const forbidden = await GET(
      new NextRequest(
        `http://localhost/api/marketplace/jumia/products/eligible?selectionId=${SELECTION_ID}`
      )
    );
    expect(forbidden.status).toBe(403);
    expect(mockFeatureGate).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();

    mockHasPermission.mockReturnValue(true);
    mockFeatureGate.mockResolvedValueOnce(
      Response.json({ code: 'requires_upgrade' }, { status: 402 })
    );
    const upgrade = await GET(
      new NextRequest(
        `http://localhost/api/marketplace/jumia/products/eligible?selectionId=${SELECTION_ID}`
      )
    );
    expect(upgrade.status).toBe(402);
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
          body: JSON.stringify({ sourceCategoryId: CATEGORY_ID }),
        }
      )
    );
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: 'Unable to create Gaming product selection',
    });
  });
});
