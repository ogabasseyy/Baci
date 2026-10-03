import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { loadMcpProductVariants } from './product-variants';
import { createSupabase } from './product-variants-test-fixtures';

describe('loadMcpProductVariants', () => {
  it('displays a zero price override instead of the base price', async () => {
    const supabase = createSupabase();
    supabase.rpc.mockResolvedValue({
      data: [
        { attributes: { color: 'Red' }, price_override: 0, stock_quantity: 2 },
      ],
      error: null,
    });
    const result = await loadMcpProductVariants({
      args: { product_id: 'phone-1' },
      merchantId: 'merchant-1',
      supabase: supabase as unknown as SupabaseClient,
      sanitizeString: (value) => value,
      formatPrice: (price) => `₦${price}`,
    });
    expect(result.content[0].text).toContain('color: Red - ₦0 (In Stock)');
    expect(result.content[0].text).not.toContain('Base price');
  });

  it('shows stocked combinations even when the first ten variants are sold out', async () => {
    const supabase = createSupabase();
    supabase.rpc.mockResolvedValue({
      data: [
        ...Array.from({ length: 10 }, (_, index) => ({
          attributes: { color: `Sold Out ${index}` },
          price_override: null,
          stock_quantity: 0,
        })),
        {
          attributes: { color: 'Available Red' },
          price_override: null,
          stock_quantity: 2,
        },
      ],
      error: null,
    });
    const result = await loadMcpProductVariants({
      args: { product_id: 'phone-1' },
      merchantId: 'merchant-1',
      supabase: supabase as unknown as SupabaseClient,
      sanitizeString: (value) => value,
      formatPrice: String,
    });
    expect(result.content[0].text).toContain('Available Red');
    expect(result.content[0].text).not.toContain('Sold Out 0');
    expect(result.structuredContent).toMatchObject({
      variants: expect.arrayContaining([
        expect.objectContaining({ availability: 'out_of_stock' }),
        expect.objectContaining({ availability: 'in_stock' }),
      ]),
    });
  });

  it('returns tracked variant availability for a selected product', async () => {
    const supabase = createSupabase();
    const result = await loadMcpProductVariants({
      args: { product_id: 'phone-1' },
      merchantId: 'merchant-1',
      supabase: supabase as unknown as SupabaseClient,
      sanitizeString: (value) => value,
      formatPrice: (price) => `₦${price}`,
    });

    expect(result.structuredContent).toMatchObject({
      product_name: 'Phone',
      variants: [{ availability: 'in_stock', stock_quantity: 2 }],
    });
    expect(result.content[0].text).toContain('Colors:');
    expect(supabase.rpc).toHaveBeenCalledWith(
      'get_storefront_product_variants',
      {
        p_product_ids: ['phone-1'],
      },
    );
    expect(supabase.rpc).not.toHaveBeenCalledWith(
      'get_product_offers',
      expect.anything(),
    );
  });
});
