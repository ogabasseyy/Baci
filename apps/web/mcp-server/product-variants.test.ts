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
      getSafeCatalogImageUrl: (url) => url ?? undefined,
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
      getSafeCatalogImageUrl: (url) => url ?? undefined,
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
      getSafeCatalogImageUrl: (url) => url ?? undefined,
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
    expect(supabase.query.select).toHaveBeenCalledWith(
      'id, name, has_variants, has_condition_offers, manage_stock, color, color_images',
    );
  });

  it('returns mapped catalog colors for a storage-only variant without inventing combinations', async () => {
    const supabase = createSupabase();
    supabase.query.single.mockResolvedValue({
      data: {
        id: 'phone-1', name: 'Phone', manage_stock: true, has_variants: true,
        has_condition_offers: false, color: null,
        color_images: { Silver: ['https://cdn.example/silver.jpg'] },
      }, error: null,
    });
    supabase.rpc.mockResolvedValue({
      data: [{ attributes: { storage: '128GB' }, price_override: null, stock_quantity: 2 }],
      error: null,
    });
    const result = await loadMcpProductVariants({
      args: { product_id: 'phone-1' }, merchantId: 'merchant-1',
      supabase: supabase as unknown as SupabaseClient,
      sanitizeString: (value) => value, formatPrice: String, getSafeCatalogImageUrl: (url) => url ?? undefined,
    });

    expect(result.content[0].text).toContain('Catalog Colors:** Silver');
    expect(result.content[0].text).toContain('Storage:** 128GB');
    expect(result.content[0].text).not.toContain('Available Colors:** Silver');
    expect(result.structuredContent).toMatchObject({
      catalog_colors: { labels: ['Silver'], source: 'product.color_images' },
      variants: [{ attributes: { storage: '128GB' }, availability: 'in_stock' }],
    });
  });

  it('returns stored catalog colors even when the product has no variant rows', async () => {
    const supabase = createSupabase();
    supabase.query.single.mockResolvedValue({
      data: {
        id: 'phone-1', name: 'Phone', manage_stock: false, has_variants: false,
        has_condition_offers: false, color: null, color_images: { Black: [] },
      }, error: null,
    });
    supabase.rpc.mockResolvedValue({ data: [], error: null });
    const result = await loadMcpProductVariants({
      args: { product_id: 'phone-1' }, merchantId: 'merchant-1',
      supabase: supabase as unknown as SupabaseClient,
      sanitizeString: (value) => value, formatPrice: String, getSafeCatalogImageUrl: (url) => url ?? undefined,
    });
    expect(result.content[0].text).toContain('Catalog Colors:** Black');
    expect(result.content[0].text).toContain('stored catalog color choices');
    expect(result.structuredContent).toMatchObject({ catalog_colors: { labels: ['Black'] } });
  });
});
