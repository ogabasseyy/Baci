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
  generateReceiptBlob,
  resolveReceiptLogoDataUri,
} = receiptRouteMocks;

describe('storefront receipt PDF downloads', () => {
  setupReceiptRouteTests();

  it('returns a sanitized PDF download for an eligible receipt', async () => {
    vi.mocked(authenticateApiRequest).mockResolvedValue(
      createAuthenticatedAuthResult()
    );
    vi.mocked(getStorefrontAccountDocumentData).mockResolvedValue(
      createDocumentData({
        order_number: 'ORD-1001\r\nSet-Cookie: evil',
      })
    );
    vi.mocked(generateReceiptBlob).mockResolvedValue(new Blob(['receipt']));

    const response = await requestReceipt();

    const contentDisposition = response.headers.get('content-disposition');

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(contentDisposition).toContain(
      'receipt-ORD-1001-Set-Cookie-evil.pdf'
    );
    expect(contentDisposition).not.toContain('\r');
    expect(contentDisposition).not.toContain('\n');
    // The route serves settled balances whose payment flag is not 'paid',
    // so the generator must not infer the kind from that flag.
    expect(vi.mocked(generateReceiptBlob)).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      {
        documentKind: 'receipt',
        documentDate: '2026-04-02T10:00:00.000Z',
        logoDataUri: 'data:image/png;base64,AQID',
      }
    );
  });

  it('downloads the receipt when optional logo resolution rejects', async () => {
    vi.mocked(authenticateApiRequest).mockResolvedValue(
      createAuthenticatedAuthResult()
    );
    vi.mocked(getStorefrontAccountDocumentData).mockResolvedValue(
      createDocumentData({})
    );
    vi.mocked(resolveReceiptLogoDataUri).mockRejectedValueOnce(
      new Error('Logo resolution failed')
    );
    vi.mocked(generateReceiptBlob).mockResolvedValue(new Blob(['receipt']));

    const response = await requestReceipt();

    expect(response.status).toBe(200);
    expect(generateReceiptBlob).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ logoDataUri: null })
    );
  });

  it('returns 500 when receipt PDF generation fails', async () => {
    const loggerErrorSpy = vi
      .spyOn(logger, 'error')
      .mockImplementation(() => undefined);

    try {
      vi.mocked(authenticateApiRequest).mockResolvedValue(
        createAuthenticatedAuthResult()
      );
      vi.mocked(getStorefrontAccountDocumentData).mockResolvedValue(
        createDocumentData({})
      );
      vi.mocked(generateReceiptBlob).mockImplementation(() => {
        throw new Error('PDF generation failed');
      });

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
