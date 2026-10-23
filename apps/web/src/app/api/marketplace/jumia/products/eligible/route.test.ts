import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockAuthenticate = vi.fn();
const mockGetUserAccess = vi.fn();
const mockHasPermission = vi.fn();
const mockFeatureGate = vi.fn();
const mockRpc = vi.fn();

vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: (...args: unknown[]) => mockAuthenticate(...args),
  getUserAccess: (...args: unknown[]) => mockGetUserAccess(...args),
  hasPermission: (...args: unknown[]) => mockHasPermission(...args),
}));
vi.mock('@/lib/merchant-feature-gates', () => ({
  requireMerchantFeatureAccess: (...args: unknown[]) =>
    mockFeatureGate(...args),
}));

const { GET } = await import('./route');

const MERCHANT_ID = '00000000-0000-4000-8000-000000000001';
const SELECTION_ID = '00000000-0000-4000-8000-000000000003';

function setupAuthorizedUser() {
  mockAuthenticate.mockResolvedValue({
    user: { id: 'user-id' },
    supabase: { rpc: mockRpc },
    error: null,
  });
  mockGetUserAccess.mockResolvedValue({ merchantId: MERCHANT_ID });
  mockHasPermission.mockReturnValue(true);
  mockFeatureGate.mockResolvedValue(null);
}

describe('Jumia Gaming eligible products API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupAuthorizedUser();
  });

  it('authenticates before returning query validation errors', async () => {
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

  it('returns a bounded eligible page and keeps unavailable product payloads under the RPC contract', async () => {
    mockRpc.mockResolvedValueOnce({
      data: {
        selectionId: SELECTION_ID,
        sourceCategoryId: '00000000-0000-4000-8000-000000000002',
        products: [
          {
            id: 'product-id',
            ordinal: 51,
            capturedSourceVersion: 'a'.repeat(64),
            currentSourceVersion: 'b'.repeat(64),
            available: false,
            unavailableReason: 'inactive',
            product: null,
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

    const response = await GET(
      new NextRequest(
        `http://localhost/api/marketplace/jumia/products/eligible?selectionId=${SELECTION_ID}&page=2&limit=50`
      )
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      selectionId: SELECTION_ID,
      total: 151,
      page: 2,
      legacyUnmappedCount: 3,
      products: [
        {
          ordinal: 51,
          available: false,
          unavailableReason: 'inactive',
          product: null,
        },
      ],
    });
    expect(mockRpc).toHaveBeenCalledWith(
      'get_jumia_product_export_selection_page',
      {
        p_selection_id: SELECTION_ID,
        p_page: 2,
        p_limit: 50,
      }
    );
    expect(mockFeatureGate).toHaveBeenCalledOnce();
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
});
