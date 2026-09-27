import { describe, expect, it, vi } from 'vitest';
import type { JumiaClient } from '@/lib/jumia/client';
import { updatePrice } from './feeds-price';

function client(response: unknown): JumiaClient {
  return {
    request: vi.fn().mockResolvedValue(response),
  } as unknown as JumiaClient;
}

describe('updatePrice', () => {
  it('validates and submits price updates', async () => {
    const mockClient = client({ feedId: 'FEED-PRICE' });
    const result = await updatePrice(mockClient, [
      {
        sellerSku: 'SKU-1',
        id: 'PRODUCT-1',
        price: { value: 100, currency: ' NGN ' },
      },
    ]);

    expect(result).toBe('FEED-PRICE');
    expect(mockClient.request).toHaveBeenCalledWith(
      'POST',
      '/feeds/products/price',
      expect.anything(),
      {
        products: [
          {
            sellerSku: 'SKU-1',
            id: 'PRODUCT-1',
            price: { value: 100, currency: 'NGN' },
          },
        ],
      }
    );
  });

  it('rejects invalid prices before making a provider request', async () => {
    const mockClient = client({ feedId: 'FEED-PRICE' });

    await expect(
      updatePrice(mockClient, [
        {
          sellerSku: 'SKU-1',
          id: 'PRODUCT-1',
          price: { value: -1, currency: 'NGN' },
        },
      ])
    ).rejects.toThrow('price.value must be a number >= 0');
    expect(mockClient.request).not.toHaveBeenCalled();
  });
});
