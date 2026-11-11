import { describe, expect, it, vi } from 'vitest';
import { logger } from '@/lib/logger';
import {
  createAuthenticatedAuthResult,
  createDocumentData,
  receiptRouteMocks,
  requestReceipt,
  setupReceiptRouteTests,
} from './route.test-support';

const {
  authenticateApiRequest,
  getStorefrontAccountDocumentData,
  checkRateLimit,
  StorefrontAccountDocumentError,
} = receiptRouteMocks;

describe('GET /api/storefront/account/orders/[id]/receipt', () => {
  setupReceiptRouteTests();

  it('returns 401 when the customer is not authenticated', async () => {
    vi.mocked(authenticateApiRequest).mockResolvedValue({
      user: null,
      error: 'Not authenticated',
      supabase: null,
    });

    const response = await requestReceipt();

    expect(response.status).toBe(401);
  });

  it('returns 429 when the download rate limit is exceeded', async () => {
    const authResult = createAuthenticatedAuthResult();

    vi.mocked(authenticateApiRequest).mockResolvedValue(authResult);
    vi.mocked(checkRateLimit).mockResolvedValue(false);

    const response = await requestReceipt();

    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('60');
    await expect(response.json()).resolves.toEqual({
      error: 'Rate limit exceeded. Please try again later.',
    });
    expect(checkRateLimit).toHaveBeenCalledWith(
      authResult.supabase,
      'user-1',
      'storefront_account_receipt_download',
      10,
      1
    );
  });

  it('returns 400 when the order id is invalid', async () => {
    vi.mocked(authenticateApiRequest).mockResolvedValue(
      createAuthenticatedAuthResult()
    );

    const response = await requestReceipt({
      id: 'not-a-uuid',
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Invalid request',
    });
  });

  it('returns 400 when merchantSlug is missing', async () => {
    vi.mocked(authenticateApiRequest).mockResolvedValue(
      createAuthenticatedAuthResult()
    );

    const response = await requestReceipt({
      merchantSlug: null,
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Invalid request',
    });
  });

  it('returns 409 when the order is not yet eligible for a receipt', async () => {
    vi.mocked(authenticateApiRequest).mockResolvedValue(
      createAuthenticatedAuthResult()
    );
    vi.mocked(getStorefrontAccountDocumentData).mockResolvedValue(
      createDocumentData({
        receipt_eligible: false,
        current_document_kind: 'invoice',
      })
    );

    const response = await requestReceipt();

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: 'Receipt is not available for this order yet',
      code: 'RECEIPT_NOT_READY',
    });
  });

  it('maps document access errors to API responses', async () => {
    vi.mocked(authenticateApiRequest).mockResolvedValue(
      createAuthenticatedAuthResult()
    );
    vi.mocked(getStorefrontAccountDocumentData).mockRejectedValue(
      new StorefrontAccountDocumentError('Order not found', 404, 'NOT_FOUND')
    );

    const response = await requestReceipt();

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: 'Order not found',
      code: 'NOT_FOUND',
    });
  });

  it('logs and returns 500 for unexpected failures', async () => {
    const loggerErrorSpy = vi
      .spyOn(logger, 'error')
      .mockImplementation(() => undefined);
    try {
      vi.mocked(authenticateApiRequest).mockResolvedValue(
        createAuthenticatedAuthResult()
      );
      vi.mocked(getStorefrontAccountDocumentData).mockRejectedValue(
        new Error('Receipt generation failed')
      );

      const response = await requestReceipt();

      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toEqual({
        error: 'Internal server error',
      });
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Unexpected storefront receipt download error',
          route: 'storefront/account/orders/[id]/receipt',
          error: expect.any(Error),
        })
      );
    } finally {
      loggerErrorSpy.mockRestore();
    }
  });
});
