import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockAuthenticate = vi.fn();
const mockGetUserAccess = vi.fn();
const mockHasPermission = vi.fn();
const mockForIntegration = vi.fn();
const mockGetOrderItems = vi.fn();
const mockGetCachedOrderItems = vi.fn();
const mockSupabase = {};

vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: (...args: unknown[]) => mockAuthenticate(...args),
  getUserAccess: (...args: unknown[]) => mockGetUserAccess(...args),
  hasPermission: (...args: unknown[]) => mockHasPermission(...args),
}));
vi.mock('@/lib/jumia/client', () => ({
  JumiaClient: {
    forIntegration: (...args: unknown[]) => mockForIntegration(...args),
  },
  JumiaApiError: class JumiaApiError extends Error {
    status: number;

    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
  jumiaErrorResponse: vi.fn(),
}));
vi.mock('@/lib/jumia/orders', () => ({
  getOrderItems: (...args: unknown[]) => mockGetOrderItems(...args),
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));
vi.mock('./get-cached-jumia-order-items', () => ({
  getCachedJumiaOrderItems: (...args: unknown[]) =>
    mockGetCachedOrderItems(...args),
}));

const { GET } = await import('./route');

const integrationId = '00000000-0000-4000-8000-000000000099';

function makeRequest() {
  return new NextRequest(
    `http://localhost/api/marketplace/jumia/orders/order-1/items?integrationId=${integrationId}`
  );
}

describe('GET /api/marketplace/jumia/orders/[id]/items', () => {
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
    mockForIntegration.mockResolvedValue({ shopId: 'shop-1' });
    mockGetOrderItems.mockResolvedValue({
      orderId: 'order-1',
      orderNumber: 'J-1',
      items: [{ id: 'item-1' }],
    });
    mockGetCachedOrderItems.mockResolvedValue({
      kind: 'ok',
      orderId: 'order-1',
      orderNumber: 'J-1',
      items: [{ id: 'cached-item-1' }],
    });
  });

  it('rejects view-only callers before creating a provider client', async () => {
    mockHasPermission.mockReturnValue(false);

    const response = await GET(makeRequest(), {
      params: Promise.resolve({ id: 'order-1' }),
    });

    expect(response.status).toBe(403);
    expect(mockForIntegration).not.toHaveBeenCalled();
    expect(mockGetOrderItems).not.toHaveBeenCalled();
  });

  it('returns order items for callers with integration view access', async () => {
    const response = await GET(makeRequest(), {
      params: Promise.resolve({ id: 'order-1' }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      orderId: 'order-1',
      orderNumber: 'J-1',
      items: [{ id: 'item-1' }],
    });
    expect(mockHasPermission).toHaveBeenCalledWith(
      expect.anything(),
      'integrations',
      'view'
    );
  });

  it('allows a view-only staff member to read order items', async () => {
    mockHasPermission.mockImplementation(
      (_access: unknown, _resource: string, action: string) => action === 'view'
    );

    const response = await GET(makeRequest(), {
      params: Promise.resolve({ id: 'order-1' }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      orderId: 'order-1',
      orderNumber: 'J-1',
      items: [{ id: 'cached-item-1' }],
    });
    expect(mockGetCachedOrderItems).toHaveBeenCalledWith({
      supabase: mockSupabase,
      merchantId: 'merchant-1',
      integrationId,
      orderId: 'order-1',
    });
    expect(mockForIntegration).not.toHaveBeenCalled();
    expect(mockGetOrderItems).not.toHaveBeenCalled();
  });
});
