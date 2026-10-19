import { describe, expect, it, vi } from 'vitest';
import { findExistingJumiaExportMapping } from './export-product-mapping-guard';

describe('findExistingJumiaExportMapping', () => {
  it('returns true when an integration-scoped mapping already exists', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: { id: 'mapping-1' },
      error: null,
    });
    const chain = {
      eq: vi.fn(),
      neq: vi.fn(),
      limit: vi.fn(() => ({ maybeSingle })),
    };
    chain.eq.mockReturnValue(chain);
    chain.neq.mockReturnValue(chain);
    const supabase = {
      from: vi.fn(() => ({
        select: vi.fn(() => chain),
      })),
    } as unknown as import('@supabase/supabase-js').SupabaseClient;

    await expect(
      findExistingJumiaExportMapping(supabase, {
        merchantId: 'merchant-1',
        productId: 'product-1',
        shopId: 'shop-1',
        marketplaceKey: 'Jumia Nigeria',
      })
    ).resolves.toBe(true);
  });
});
