import { describe, expect, it, vi } from 'vitest';
import { resolveMerchantIdBySlug } from './resolve-merchant-id-by-slug';

describe('resolveMerchantIdBySlug', () => {
  it('resolves a merchant id from its slug', async () => {
    const single = vi.fn().mockResolvedValue({
      data: { id: 'merchant-1' },
      error: null,
    });
    const supabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single,
      }),
    };

    await expect(resolveMerchantIdBySlug('shop', supabase)).resolves.toBe(
      'merchant-1'
    );
  });
});
