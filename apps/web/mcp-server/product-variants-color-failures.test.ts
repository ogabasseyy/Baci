import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { loadMcpProductVariants } from './product-variants';
import { createSupabase } from './product-variants-test-fixtures';

describe('loadMcpProductVariants catalog colors during lookup failures', () => {
  it('preserves mapped colors and safe images when the variant lookup fails', async () => {
    const supabase = createSupabase();
    supabase.query.single.mockResolvedValue({
      data: {
        id: 'phone-1', name: 'Phone', manage_stock: true, has_variants: true,
        has_condition_offers: false, color: null,
        color_images: { Silver: ['https://cdn.example/silver.jpg'] },
      }, error: null,
    });
    supabase.rpc.mockResolvedValue({ data: null, error: { message: 'unavailable' } });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = await loadMcpProductVariants({
        args: { product_id: 'phone-1' }, merchantId: 'merchant-1',
        supabase: supabase as unknown as SupabaseClient,
        sanitizeString: (value) => value, formatPrice: String,
        getSafeCatalogImageUrl: (url) => url?.startsWith('https://') ? url : undefined,
      });
      expect(result.content[0].text).toContain('Product variants are temporarily unavailable.');
      expect(result.content[0].text).toContain('**Catalog Colors:** Silver');
      expect(result.content[0].text).toContain('stock and specific color/storage/price pairings are unconfirmed');
      expect(result.content[0].text).not.toContain('Available Combinations');
      expect(result.structuredContent).toMatchObject({
        catalog_colors: {
          labels: ['Silver'], source: 'product.color_images',
          images_by_color: { Silver: ['https://cdn.example/silver.jpg'] },
        },
        variant_lookup_failed: true,
      });
    } finally {
      log.mockRestore();
    }
  });

  it.each([
    { label: 'offer-only', has_variants: false, has_condition_offers: true, message: 'Product offers are temporarily unavailable.' },
    { label: 'variant-and-offer', has_variants: true, has_condition_offers: true, message: 'Product options are temporarily unavailable.' },
  ])('preserves mapped colors when $label lookups fail', async ({ has_variants, has_condition_offers, message }) => {
    const supabase = createSupabase();
    supabase.query.single.mockResolvedValue({
      data: {
        id: 'phone-1', name: 'Phone', manage_stock: true, has_variants,
        has_condition_offers, color: null,
        color_images: { Graphite: ['https://cdn.example/graphite.jpg'] },
      }, error: null,
    });
    supabase.rpc.mockResolvedValue({ data: null, error: { message: 'unavailable' } });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = await loadMcpProductVariants({
        args: { product_id: 'phone-1' }, merchantId: 'merchant-1',
        supabase: supabase as unknown as SupabaseClient,
        sanitizeString: (value) => value, formatPrice: String,
        getSafeCatalogImageUrl: (url) => url?.startsWith('https://') ? url : undefined,
      });
      expect(result.content[0].text).toContain(message);
      expect(result.content[0].text).toContain('**Catalog Colors:** Graphite');
      expect(result.content[0].text).not.toContain('Available Combinations');
      expect(result.structuredContent).toMatchObject({
        catalog_colors: {
          labels: ['Graphite'], source: 'product.color_images',
          images_by_color: { Graphite: ['https://cdn.example/graphite.jpg'] },
        },
      });
      if (has_variants && has_condition_offers) {
        expect(supabase.rpc).toHaveBeenCalledWith('get_storefront_product_variants', { p_product_ids: ['phone-1'] });
        expect(supabase.rpc).toHaveBeenCalledWith('get_product_offers', { p_product_id: 'phone-1' });
      }
    } finally {
      log.mockRestore();
    }
  });
});
