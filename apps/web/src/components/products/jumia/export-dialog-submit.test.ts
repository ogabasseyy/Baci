import { beforeEach, describe, expect, it, vi } from 'vitest';
import { submitJumiaExport } from './export-dialog-submit';

const { mockFetchWithCsrf } = vi.hoisted(() => ({
  mockFetchWithCsrf: vi.fn(),
}));

vi.mock('@/lib/api-client', () => ({
  fetchWithCsrf: mockFetchWithCsrf,
}));

vi.mock('@/lib/sanitize-core', () => ({
  sanitizeText: (value: string) => value.replace(/[<>]/g, ''),
  stripHtmlTags: (value: string) => value.replace(/<[^>]*>/g, ''),
}));

const params = {
  product: {
    id: 'product-1',
    sku: 'SKU-1',
    name: '<b>Test Product</b>',
    description: '<p>Product description</p>',
    price: 5000,
    images: ['https://cdn.example/product.jpg', 'ftp://invalid.example/file'],
  },
  merchantId: 'merchant-1',
  integrationId: 'integration-1',
  categoryCode: 42,
  brand: { code: 7, name: '<i>Test Brand</i>' },
};

describe('submitJumiaExport', () => {
  beforeEach(() => {
    mockFetchWithCsrf.mockReset();
  });

  it('sanitizes and forwards the selected product mapping', async () => {
    mockFetchWithCsrf.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, feedId: 'feed-123' }),
    });

    const result = await submitJumiaExport(params);

    expect(result).toEqual({ ok: true, feedId: 'feed-123' });
    expect(mockFetchWithCsrf).toHaveBeenCalledWith(
      '/api/marketplace/jumia/products/export',
      expect.objectContaining({ method: 'POST' })
    );

    const [, request] = mockFetchWithCsrf.mock.calls[0];
    expect(JSON.parse(request.body)).toEqual({
      integrationId: 'integration-1',
      merchantId: 'merchant-1',
      productId: 'product-1',
      name: 'Test Product',
      brand: { code: 7, name: 'Test Brand' },
      category: { code: 42 },
      description: 'Product description',
      images: [{ url: 'https://cdn.example/product.jpg', primary: true }],
      variations: [{ sellerSku: 'SKU-1', price: 5000, currency: 'NGN' }],
    });
  });

  it('returns bounded feed errors from a successful HTTP response', async () => {
    mockFetchWithCsrf.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: false,
        error: 'Export rejected',
        feedErrors: ['first', 'second', 'third', 'fourth'],
      }),
    });

    const result = await submitJumiaExport(params);

    expect(result).toEqual({
      ok: false,
      message: 'Export rejected\nfirst\nsecond\nthird\n... (1 more errors)',
    });
  });

  it('treats an accepted 207 export as partial success', async () => {
    mockFetchWithCsrf.mockResolvedValue({
      ok: true,
      status: 207,
      json: async () => ({
        success: false,
        partial: true,
        feedId: 'feed-1',
        error: 'Feed-status reconciliation will recover the accepted feed.',
      }),
    });

    const result = await submitJumiaExport(params);

    expect(result).toEqual({
      ok: true,
      feedId: 'feed-1',
      partial: true,
      message: 'Feed-status reconciliation will recover the accepted feed.',
    });
  });

  it('propagates transport failures for the dialog error boundary', async () => {
    mockFetchWithCsrf.mockRejectedValue(new Error('network unavailable'));

    await expect(submitJumiaExport(params)).rejects.toThrow(
      'network unavailable'
    );
  });
});
