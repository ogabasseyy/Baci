import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockAuthenticate = vi.fn();
const mockGetUserAccess = vi.fn();
const mockHasPermission = vi.fn();
const mockForMerchant = vi.fn();
const mockGetAllCategories = vi.fn();
const mockSupabase = {};

vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: (...args: unknown[]) => mockAuthenticate(...args),
  getUserAccess: (...args: unknown[]) => mockGetUserAccess(...args),
  hasPermission: (...args: unknown[]) => mockHasPermission(...args),
}));
vi.mock('@/lib/jumia/catalog', () => ({
  getAllCategories: (...args: unknown[]) => mockGetAllCategories(...args),
}));
vi.mock('@/lib/jumia/client', () => ({
  JumiaClient: {
    forMerchant: (...args: unknown[]) => mockForMerchant(...args),
  },
}));
vi.mock('@/lib/jumia/helpers', () => ({
  JumiaApiError: class JumiaApiError extends Error {
    status: number;

    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
}));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn() },
}));

const { GET } = await import('./route');

describe('GET /api/marketplace/jumia/categories', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({
      user: { id: 'user-1' },
      error: null,
      supabase: mockSupabase,
    });
    mockGetUserAccess.mockResolvedValue({
      merchantId: 'merchant-1',
      isOwner: false,
      isStaff: true,
      role: 'staff',
      permissions: {},
    });
    mockHasPermission.mockReturnValue(true);
    mockForMerchant.mockResolvedValue({ shopId: 'shop-1' });
    mockGetAllCategories.mockResolvedValue([{ id: 'cat-1', name: 'Phones' }]);
  });

  it('rejects view-only callers before creating a provider client', async () => {
    mockHasPermission.mockReturnValue(false);

    const response = await GET(
      new NextRequest('http://localhost/api/marketplace/jumia/categories')
    );

    expect(response.status).toBe(403);
    expect(mockForMerchant).not.toHaveBeenCalled();
    expect(mockGetAllCategories).not.toHaveBeenCalled();
  });

  it('returns categories for callers with integration management access', async () => {
    const response = await GET(
      new NextRequest('http://localhost/api/marketplace/jumia/categories')
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      categories: [{ id: 'cat-1', name: 'Phones' }],
      configured: true,
    });
    expect(mockHasPermission).toHaveBeenCalledWith(
      expect.anything(),
      'integrations',
      'manage'
    );
  });
});
