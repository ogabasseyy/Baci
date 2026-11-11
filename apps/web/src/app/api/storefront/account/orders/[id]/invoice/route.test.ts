import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoiceTestSupport } from './route.test-support';

const {
  mockGeneratePeppolInvoiceXml,
  mockResolveReceiptLogoDataUri,
  authenticateApiRequest,
  checkRateLimit,
  getStorefrontAccountDocumentData,
  StorefrontAccountDocumentError,
  GET,
  createAuthenticatedAuthResult,
} = invoiceTestSupport;

describe('GET /api/storefront/account/orders/[id]/invoice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkRateLimit).mockResolvedValue(true);
    mockGeneratePeppolInvoiceXml.mockReturnValue('<Invoice />');
    mockResolveReceiptLogoDataUri.mockResolvedValue(
      'data:image/png;base64,AA=='
    );
  });

  it('returns 401 when the customer is not authenticated', async () => {
    vi.mocked(authenticateApiRequest).mockResolvedValue({
      user: null,
      error: 'Not authenticated',
      supabase: null,
    });

    const response = await GET(
      new NextRequest(
        'http://localhost/api/storefront/account/orders/cfa945fc-9bf4-4485-857c-4d4374adf31f/invoice?merchantSlug=ogabassey'
      ),
      {
        params: Promise.resolve({
          id: 'cfa945fc-9bf4-4485-857c-4d4374adf31f',
        }),
      }
    );

    expect(response.status).toBe(401);
  });

  it('returns 401 before awaiting route params when unauthenticated', async () => {
    vi.mocked(authenticateApiRequest).mockResolvedValue({
      user: null,
      error: 'Not authenticated',
      supabase: null,
    });
    const paramsThen = vi.fn();
    const params = {} as Promise<{ id: string }>;
    Object.defineProperty(params, 'then', {
      value: paramsThen,
    });

    const response = await GET(
      new NextRequest(
        'http://localhost/api/storefront/account/orders/not-a-uuid/invoice'
      ),
      {
        params,
      }
    );

    expect(response.status).toBe(401);
    expect(paramsThen).not.toHaveBeenCalled();
    expect(checkRateLimit).not.toHaveBeenCalled();
  });

  it('returns 429 when the download rate limit is exceeded', async () => {
    vi.mocked(authenticateApiRequest).mockResolvedValue(
      createAuthenticatedAuthResult()
    );
    vi.mocked(checkRateLimit).mockResolvedValue(false);

    const response = await GET(
      new NextRequest(
        'http://localhost/api/storefront/account/orders/cfa945fc-9bf4-4485-857c-4d4374adf31f/invoice?merchantSlug=ogabassey'
      ),
      {
        params: Promise.resolve({
          id: 'cfa945fc-9bf4-4485-857c-4d4374adf31f',
        }),
      }
    );

    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('60');
    await expect(response.json()).resolves.toEqual({
      error: 'Rate limit exceeded. Please try again later.',
    });
  });

  it('returns 400 when merchantSlug is missing', async () => {
    vi.mocked(authenticateApiRequest).mockResolvedValue(
      createAuthenticatedAuthResult()
    );

    const response = await GET(
      new NextRequest(
        'http://localhost/api/storefront/account/orders/cfa945fc-9bf4-4485-857c-4d4374adf31f/invoice'
      ),
      {
        params: Promise.resolve({
          id: 'cfa945fc-9bf4-4485-857c-4d4374adf31f',
        }),
      }
    );

    expect(response.status).toBe(400);
  });

  it('returns 400 when the order id is invalid', async () => {
    vi.mocked(authenticateApiRequest).mockResolvedValue(
      createAuthenticatedAuthResult()
    );

    const response = await GET(
      new NextRequest(
        'http://localhost/api/storefront/account/orders/not-a-uuid/invoice?merchantSlug=ogabassey'
      ),
      {
        params: Promise.resolve({
          id: 'not-a-uuid',
        }),
      }
    );

    expect(response.status).toBe(400);
  });

  it('maps document access errors to API responses', async () => {
    vi.mocked(authenticateApiRequest).mockResolvedValue(
      createAuthenticatedAuthResult()
    );
    vi.mocked(getStorefrontAccountDocumentData).mockRejectedValue(
      new StorefrontAccountDocumentError('Order not found', 404, 'NOT_FOUND')
    );

    const response = await GET(
      new NextRequest(
        'http://localhost/api/storefront/account/orders/cfa945fc-9bf4-4485-857c-4d4374adf31f/invoice?merchantSlug=ogabassey'
      ),
      {
        params: Promise.resolve({
          id: 'cfa945fc-9bf4-4485-857c-4d4374adf31f',
        }),
      }
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: 'Order not found',
      code: 'NOT_FOUND',
    });
  });

  it('logs and returns 500 for unexpected failures', async () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    vi.mocked(authenticateApiRequest).mockResolvedValue(
      createAuthenticatedAuthResult()
    );
    vi.mocked(getStorefrontAccountDocumentData).mockRejectedValue(
      new Error('Invoice generation failed')
    );

    const response = await GET(
      new NextRequest(
        'http://localhost/api/storefront/account/orders/cfa945fc-9bf4-4485-857c-4d4374adf31f/invoice?merchantSlug=ogabassey'
      ),
      {
        params: Promise.resolve({
          id: 'cfa945fc-9bf4-4485-857c-4d4374adf31f',
        }),
      }
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: 'Internal server error',
    });
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Unexpected storefront invoice download error:',
      expect.any(Error)
    );

    consoleErrorSpy.mockRestore();
  });
});
