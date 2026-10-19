import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/* ------------------------------------------------------------------ */
/*  Mocks                                                              */
/* ------------------------------------------------------------------ */

const mockGetUser = vi.fn();
const mockSupabase = { auth: { getUser: mockGetUser } };
const mockRequireMerchantFeatureAccess = vi.fn();
const { mockHasPermission } = vi.hoisted(() => ({
  mockHasPermission: vi.fn().mockReturnValue(true),
}));

vi.mock('next/headers', () => ({ cookies: vi.fn().mockResolvedValue({}) }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => mockSupabase),
}));

vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: vi.fn().mockResolvedValue({ valid: true }),
}));

const mockGetMerchant = vi.fn();
const mockToUserAccess = vi.fn();
vi.mock('@/lib/get-merchant-for-api-request', () => ({
  getMerchantForApiRequest: (...a: unknown[]) => mockGetMerchant(...a),
  toUserAccess: (...a: unknown[]) => mockToUserAccess(...a),
}));

vi.mock('@/lib/api-auth', () => ({
  hasPermission: mockHasPermission,
}));

const mockForIntegration = vi.fn();
vi.mock('@/lib/jumia/client', async () => {
  const {
    JumiaApiError: RealJumiaApiError,
    jumiaErrorResponse: realJumiaErrorResponse,
  } = await vi.importActual<typeof import('@/lib/jumia/helpers')>(
    '@/lib/jumia/helpers'
  );
  return {
    JumiaClient: {
      forIntegration: (...a: unknown[]) => mockForIntegration(...a),
    },
    JumiaApiError: RealJumiaApiError,
    jumiaErrorResponse: realJumiaErrorResponse,
  };
});

const mockGetStock = vi.fn();
const mockCreateOrder = vi.fn();
const mockUpdateOrder = vi.fn();
vi.mock('@/lib/jumia/consignment', () => ({
  getConsignmentStock: (...a: unknown[]) => mockGetStock(...a),
  createConsignmentOrder: (...a: unknown[]) => mockCreateOrder(...a),
  updateConsignmentOrder: (...a: unknown[]) => mockUpdateOrder(...a),
}));
vi.mock('@/lib/merchant-feature-gates', () => ({
  requireMerchantFeatureAccess: (...args: unknown[]) =>
    mockRequireMerchantFeatureAccess(...args),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  },
}));
vi.mock('@/lib/sanitize-core', () => ({
  sanitizeText: (v: string) => v,
}));

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const MERCHANT_CTX = {
  merchantId: '00000000-0000-4000-8000-000000000001',
  staffAccess: {
    role: 'owner',
    isOwner: true,
    isStaff: false,
    permissions: {},
  },
};

const INT_ID = '00000000-0000-4000-8000-000000000099';

function makeGetRequest(params: Record<string, string>) {
  const url = new URL('http://localhost/api/marketplace/jumia/consignment');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new NextRequest(url);
}

function makeJsonRequest(method: string, body: unknown) {
  return new NextRequest('http://localhost/api/marketplace/jumia/consignment', {
    method,
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

function setupAuth() {
  mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
  mockGetMerchant.mockResolvedValue(MERCHANT_CTX);
  mockToUserAccess.mockReturnValue({
    merchantId: MERCHANT_CTX.merchantId,
    role: 'owner',
    isOwner: true,
    isStaff: false,
    permissions: {},
  });
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

import { GET, PATCH, POST } from './route';

describe('Consignment GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireMerchantFeatureAccess.mockResolvedValue(null);
  });

  it('returns 401 when unauthenticated', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: { message: 'no' },
    });
    const res = await GET(
      makeGetRequest({
        integrationId: INT_ID,
        sku: 'S1',
        businessClientCode: 'BC',
      })
    );
    expect(res.status).toBe(401);
  });

  it('returns 404 when merchant not found', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'u1' } },
      error: null,
    });
    mockGetMerchant.mockResolvedValue(null);
    const res = await GET(
      makeGetRequest({
        integrationId: INT_ID,
        sku: 'S1',
        businessClientCode: 'BC',
      })
    );
    expect(res.status).toBe(404);
  });

  it('returns 403 when permission denied', async () => {
    setupAuth();
    mockHasPermission.mockReturnValueOnce(false);
    const res = await GET(
      makeGetRequest({
        integrationId: INT_ID,
        sku: 'S1',
        businessClientCode: 'BC',
      })
    );
    expect(res.status).toBe(403);
  });

  it('returns 403 for view-only staff while requiring integrations.manage', async () => {
    setupAuth();
    mockToUserAccess.mockReturnValueOnce({
      role: 'staff',
      permissions: { integrations: { view: true, manage: false } },
    });
    mockHasPermission.mockImplementationOnce(
      (_access: unknown, _resource: unknown, action: unknown) =>
        action === 'view'
    );

    const res = await GET(
      makeGetRequest({
        integrationId: INT_ID,
        sku: 'S1',
        businessClientCode: 'BC',
      })
    );

    expect(res.status).toBe(403);
    expect(mockHasPermission).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'staff' }),
      'integrations',
      'manage'
    );
  });

  it('returns 400 for invalid query params', async () => {
    setupAuth();
    const res = await GET(
      makeGetRequest({ integrationId: 'bad', sku: '', businessClientCode: '' })
    );
    expect(res.status).toBe(400);
  });

  it('returns 402 before creating a Jumia client when marketplace sync is locked', async () => {
    setupAuth();
    mockRequireMerchantFeatureAccess.mockResolvedValueOnce(
      Response.json(
        {
          code: 'requires_upgrade',
          error: 'Marketplace sync requires Baci Pro',
        },
        { status: 402 }
      )
    );

    const res = await GET(
      makeGetRequest({
        integrationId: INT_ID,
        sku: 'S1',
        businessClientCode: 'BC',
      })
    );
    const body = await res.json();

    expect(res.status).toBe(402);
    expect(body.code).toBe('requires_upgrade');
    expect(mockForIntegration).not.toHaveBeenCalled();
    expect(mockGetStock).not.toHaveBeenCalled();
  });

  it('returns 500 for unexpected non-JumiaApiError exceptions', async () => {
    setupAuth();
    mockForIntegration.mockRejectedValue(new Error('unexpected'));
    const res = await GET(
      makeGetRequest({
        integrationId: INT_ID,
        sku: 'S1',
        businessClientCode: 'BC',
      })
    );
    expect(res.status).toBe(500);
  });

  it('returns stock on success', async () => {
    setupAuth();
    mockForIntegration.mockResolvedValue({ shopId: 'shop1' });
    mockGetStock.mockResolvedValue({ available: 42 });
    const res = await GET(
      makeGetRequest({
        integrationId: INT_ID,
        sku: 'SKU1',
        businessClientCode: 'BC1',
      })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ available: 42 });
    expect(mockHasPermission).toHaveBeenCalledWith(
      expect.anything(),
      'integrations',
      'manage'
    );
  });

  it('handles JumiaApiError', async () => {
    setupAuth();
    const { JumiaApiError } = await import('@/lib/jumia/client');
    mockForIntegration.mockRejectedValue(
      new JumiaApiError(429, 'Rate limited')
    );
    const res = await GET(
      makeGetRequest({
        integrationId: INT_ID,
        sku: 'S1',
        businessClientCode: 'BC',
      })
    );
    expect(res.status).toBe(429);
  });
});

describe('Consignment POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireMerchantFeatureAccess.mockResolvedValue(null);
  });

  it('returns 401 when unauthenticated', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: { message: 'no' },
    });
    const res = await POST(
      makeJsonRequest('POST', {
        integrationId: INT_ID,
        businessClientCode: 'BC1',
        shippingDate: '2026-04-01',
        products: [{ sku: 'SKU1', quantity: 10 }],
      })
    );
    expect(res.status).toBe(401);
  });

  it('returns 403 on CSRF failure', async () => {
    setupAuth();
    const { checkCsrfProtection } = await import('@/lib/csrf');
    (checkCsrfProtection as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      valid: false,
      response: null,
    });
    const res = await POST(makeJsonRequest('POST', {}));
    expect(res.status).toBe(403);
  });

  it('returns 400 for invalid body', async () => {
    setupAuth();
    const res = await POST(makeJsonRequest('POST', { integrationId: 'bad' }));
    expect(res.status).toBe(400);
  });

  it('returns 404 when merchant not found', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'u1' } },
      error: null,
    });
    mockGetMerchant.mockResolvedValue(null);
    const res = await POST(
      makeJsonRequest('POST', {
        integrationId: INT_ID,
        businessClientCode: 'BC1',
        shippingDate: '2026-04-01',
        products: [{ sku: 'SKU1', quantity: 10 }],
      })
    );
    expect(res.status).toBe(404);
  });

  it('returns 403 when permission denied', async () => {
    setupAuth();
    const { hasPermission } = await import('@/lib/api-auth');
    (hasPermission as ReturnType<typeof vi.fn>).mockReturnValueOnce(false);
    const res = await POST(
      makeJsonRequest('POST', {
        integrationId: INT_ID,
        businessClientCode: 'BC1',
        shippingDate: '2026-04-01',
        products: [{ sku: 'SKU1', quantity: 10 }],
      })
    );
    expect(res.status).toBe(403);
  });

  it('returns 402 before creating a Jumia client when marketplace sync is locked', async () => {
    setupAuth();
    mockRequireMerchantFeatureAccess.mockResolvedValueOnce(
      Response.json(
        {
          code: 'requires_upgrade',
          error: 'Marketplace sync requires Baci Pro',
        },
        { status: 402 }
      )
    );

    const res = await POST(
      makeJsonRequest('POST', {
        integrationId: INT_ID,
        businessClientCode: 'BC1',
        shippingDate: '2026-04-01',
        products: [{ sku: 'SKU1', quantity: 10 }],
      })
    );
    const body = await res.json();

    expect(res.status).toBe(402);
    expect(body.code).toBe('requires_upgrade');
    expect(mockForIntegration).not.toHaveBeenCalled();
    expect(mockCreateOrder).not.toHaveBeenCalled();
  });

  it('propagates JumiaApiError status', async () => {
    setupAuth();
    const { JumiaApiError } = await import('@/lib/jumia/client');
    mockForIntegration.mockRejectedValue(
      new JumiaApiError(429, 'Rate limited')
    );
    const res = await POST(
      makeJsonRequest('POST', {
        integrationId: INT_ID,
        businessClientCode: 'BC1',
        shippingDate: '2026-04-01',
        products: [{ sku: 'SKU1', quantity: 10 }],
      })
    );
    expect(res.status).toBe(429);
  });

  it('returns purchaseOrderNumber on success', async () => {
    setupAuth();
    mockForIntegration.mockResolvedValue({ shopId: 'shop1' });
    mockCreateOrder.mockResolvedValue({ purchaseOrderNumber: 'PO-123' });
    const body = {
      integrationId: INT_ID,
      businessClientCode: 'BC1',
      shippingDate: '2026-04-01',
      products: [{ sku: 'SKU1', quantity: 10 }],
    };
    const res = await POST(makeJsonRequest('POST', body));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ purchaseOrderNumber: 'PO-123' });
  });

  it('rejects a business client code from another selected marketplace', async () => {
    setupAuth();
    mockForIntegration.mockResolvedValue({
      shopId: 'shop1',
      marketplaceKey: 'NG-RETAIL',
    });
    const body = {
      integrationId: INT_ID,
      businessClientCode: 'GH-RETAIL',
      shippingDate: '2026-04-01',
      products: [{ sku: 'SKU1', quantity: 10 }],
    };

    const res = await POST(makeJsonRequest('POST', body));

    expect(res.status).toBe(400);
    expect(mockCreateOrder).not.toHaveBeenCalled();
  });

  it('derives the provider business client code from the selected marketplace', async () => {
    setupAuth();
    mockForIntegration.mockResolvedValue({
      shopId: 'shop1',
      marketplaceKey: 'NG-RETAIL',
    });
    mockCreateOrder.mockResolvedValue({ purchaseOrderNumber: 'PO-123' });
    const body = {
      integrationId: INT_ID,
      businessClientCode: 'NG-RETAIL',
      shippingDate: '2026-04-01',
      products: [{ sku: 'SKU1', quantity: 10 }],
    };

    const res = await POST(makeJsonRequest('POST', body));

    expect(res.status).toBe(200);
    expect(mockCreateOrder).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ businessClientCode: 'NG-RETAIL' })
    );
  });
});

describe('Consignment PATCH', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireMerchantFeatureAccess.mockResolvedValue(null);
  });

  it('returns 401 when unauthenticated', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: { message: 'no' },
    });
    const res = await PATCH(
      makeJsonRequest('PATCH', {
        integrationId: INT_ID,
        purchaseOrderNumber: 'PO-1',
        isShipped: true,
      })
    );
    expect(res.status).toBe(401);
  });

  it('returns 403 on CSRF failure', async () => {
    setupAuth();
    const { checkCsrfProtection } = await import('@/lib/csrf');
    (checkCsrfProtection as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      valid: false,
      response: null,
    });
    const res = await PATCH(makeJsonRequest('PATCH', {}));
    expect(res.status).toBe(403);
  });

  it('returns 400 when no update fields provided', async () => {
    setupAuth();
    const body = { integrationId: INT_ID, purchaseOrderNumber: 'PO-1' };
    const res = await PATCH(makeJsonRequest('PATCH', body));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('No update fields provided');
  });

  it('returns 404 when merchant not found', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'u1' } },
      error: null,
    });
    mockGetMerchant.mockResolvedValue(null);
    const res = await PATCH(
      makeJsonRequest('PATCH', {
        integrationId: INT_ID,
        purchaseOrderNumber: 'PO-1',
        isShipped: true,
      })
    );
    expect(res.status).toBe(404);
  });

  it('returns 403 when permission denied', async () => {
    setupAuth();
    const { hasPermission } = await import('@/lib/api-auth');
    (hasPermission as ReturnType<typeof vi.fn>).mockReturnValueOnce(false);
    const res = await PATCH(
      makeJsonRequest('PATCH', {
        integrationId: INT_ID,
        purchaseOrderNumber: 'PO-1',
        isShipped: true,
      })
    );
    expect(res.status).toBe(403);
  });

  it('returns 402 before creating a Jumia client when marketplace sync is locked', async () => {
    setupAuth();
    mockRequireMerchantFeatureAccess.mockResolvedValueOnce(
      Response.json(
        {
          code: 'requires_upgrade',
          error: 'Marketplace sync requires Baci Pro',
        },
        { status: 402 }
      )
    );

    const res = await PATCH(
      makeJsonRequest('PATCH', {
        integrationId: INT_ID,
        purchaseOrderNumber: 'PO-1',
        isShipped: true,
      })
    );
    const body = await res.json();

    expect(res.status).toBe(402);
    expect(body.code).toBe('requires_upgrade');
    expect(mockForIntegration).not.toHaveBeenCalled();
    expect(mockUpdateOrder).not.toHaveBeenCalled();
  });

  it('propagates JumiaApiError status', async () => {
    setupAuth();
    const { JumiaApiError } = await import('@/lib/jumia/client');
    mockForIntegration.mockRejectedValue(new JumiaApiError(502, 'Bad Gateway'));
    const res = await PATCH(
      makeJsonRequest('PATCH', {
        integrationId: INT_ID,
        purchaseOrderNumber: 'PO-1',
        isShipped: true,
      })
    );
    expect(res.status).toBe(502);
  });

  it('returns success on valid update', async () => {
    setupAuth();
    mockForIntegration.mockResolvedValue({ shopId: 'shop1' });
    mockUpdateOrder.mockResolvedValue(undefined);
    const body = {
      integrationId: INT_ID,
      purchaseOrderNumber: 'PO-1',
      isShipped: true,
    };
    const res = await PATCH(makeJsonRequest('PATCH', body));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
  });
});
