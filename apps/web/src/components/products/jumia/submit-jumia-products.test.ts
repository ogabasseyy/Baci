import { describe, expect, it, vi } from 'vitest';
import { submitJumiaProducts } from './submit-jumia-products';

const mockFetchWithCsrf = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api-client', () => ({
  fetchWithCsrf: (...args: unknown[]) => mockFetchWithCsrf(...args),
}));

const product = {
  id: 'product-1',
  name: 'Phone',
  sku: 'PHONE-1',
  price: 100,
  image: 'https://cdn.example.com/phone.jpg',
};

describe('submitJumiaProducts', () => {
  it('submits products with the validated export payload', async () => {
    mockFetchWithCsrf.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
    });

    const result = await submitJumiaProducts({
      products: [product],
      integrationId: 'integration-1',
      categoryCode: 42,
      brand: { code: 7, name: 'Acme' },
      marketplaceCurrency: 'NGN',
    });

    expect(result).toEqual([{ ok: true, body: { success: true } }]);
    expect(mockFetchWithCsrf).toHaveBeenCalledWith(
      '/api/marketplace/jumia/products/export',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('returns a safe failure result when a product submission throws', async () => {
    mockFetchWithCsrf.mockRejectedValue(new Error('network unavailable'));

    await expect(
      submitJumiaProducts({
        products: [product],
        integrationId: 'integration-1',
        categoryCode: 42,
        brand: { code: 7, name: 'Acme' },
        marketplaceCurrency: 'NGN',
      })
    ).resolves.toEqual([
      { ok: false, body: { error: 'Failed to submit product to Jumia' } },
    ]);
  });

  it('treats an accepted 207 export as partial success', async () => {
    mockFetchWithCsrf.mockResolvedValue({
      ok: true,
      status: 207,
      json: async () => ({
        success: false,
        partial: true,
        feedId: 'feed-1',
        error: 'Mapping reconciliation is pending',
      }),
    });

    await expect(
      submitJumiaProducts({
        products: [product],
        integrationId: 'integration-1',
        categoryCode: 42,
        brand: { code: 7, name: 'Acme' },
        marketplaceCurrency: 'NGN',
      })
    ).resolves.toEqual([
      {
        ok: true,
        partial: true,
        body: {
          success: false,
          partial: true,
          feedId: 'feed-1',
          error: 'Mapping reconciliation is pending',
        },
      },
    ]);
  });
});
