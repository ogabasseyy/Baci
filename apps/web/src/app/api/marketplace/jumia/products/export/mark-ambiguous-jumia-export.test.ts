import { describe, expect, it, vi } from 'vitest';
import {
  AMBIGUOUS_JUMIA_EXPORT_ERROR,
  markAmbiguousJumiaExport,
} from './mark-ambiguous-jumia-export';

describe('markAmbiguousJumiaExport', () => {
  it('records a durable manual-resolution state without releasing the SKU', async () => {
    const builder = {
      eq: vi.fn(),
      is: vi.fn(),
      in: vi.fn().mockResolvedValue({ error: null }),
    };
    builder.eq.mockReturnValue(builder);
    builder.is.mockReturnValue(builder);
    const update = vi.fn(() => builder);

    await expect(
      markAmbiguousJumiaExport({ from: vi.fn(() => ({ update })) } as never, {
        merchantId: 'merchant-1',
        productId: 'product-1',
        shopId: 'shop-1',
        marketplaceKey: 'marketplace-1',
        exportVariations: [{ sellerSku: 'SKU-1', price: 100, currency: 'NGN' }],
      })
    ).resolves.toBe(true);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        sync_status: 'pending',
        sync_error: AMBIGUOUS_JUMIA_EXPORT_ERROR,
      })
    );
  });
});
