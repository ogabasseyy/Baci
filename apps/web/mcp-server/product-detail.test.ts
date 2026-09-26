import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { buildMcpProductDetail } from './product-detail';

const product = {
  id: 'option-phone', name: 'Option Phone', slug: null, price: 100000,
  compare_at_price: null, images: [], description: null, stock_quantity: 0,
  manage_stock: true, condition: 'new', condition_detail: null, brand: null,
  category: null, has_variants: true, has_condition_offers: false, schema_markup: null,
};

describe('buildMcpProductDetail', () => {
  it('keeps product details and stocked offers when the variant lookup fails', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const rpc = vi.fn(async (name: string) => name === 'get_storefront_product_variants'
      ? { data: null, error: { message: 'variants unavailable' } }
      : { data: [{ condition: 'used', price: 70000, stock_quantity: 2, grade: null, condition_notes: null }], error: null });
    try {
      const result = await buildMcpProductDetail({
        product: { ...product, description: 'A useful phone', has_condition_offers: true },
        supabase: { rpc } as unknown as SupabaseClient,
        formatPrice: String, getSafeCatalogImageUrl: () => undefined,
      });
      expect(rpc).toHaveBeenCalledWith('get_product_offers', { p_product_id: product.id });
      expect(result.content[0].text).toContain('A useful phone');
      expect(result.content[0].text).toContain('• used: 70000 - In Stock');
      expect(result.structuredContent).toMatchObject({
        products: [{ stock_confidence: 'low' }],
        condition_offers: [{ availability: 'in_stock' }],
      });
    } finally {
      log.mockRestore();
    }
  });

  it('keeps stocked variants when a combined product offer lookup fails', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const rpc = vi.fn(async (name: string) => name === 'get_product_offers'
      ? { data: null, error: { message: 'offers unavailable' } }
      : { data: [{ attributes: { color: 'Red' }, price_override: null, stock_quantity: 2, condition: 'new', images: [] }], error: null });
    try {
      const result = await buildMcpProductDetail({
        product: { ...product, has_condition_offers: true },
        supabase: { rpc } as unknown as SupabaseClient,
        formatPrice: String, getSafeCatalogImageUrl: () => undefined,
      });
      expect(result.content[0].text).toContain('**Available Colors:** Red');
      expect(result.content[0].text).toContain('Condition offers are temporarily unavailable.');
      expect(result.structuredContent).toMatchObject({
        products: [{ stock_confidence: 'low' }],
        variants: [{ availability: 'in_stock' }],
        offer_lookup_failed: true,
      });
    } finally {
      log.mockRestore();
    }
  });

  it('lists only stocked offers as available while retaining sold-out offers in structured output', async () => {
    const supabase = { rpc: vi.fn(async () => ({
      data: [
        { condition: 'new', price: 100000, stock_quantity: 2, grade: null, condition_notes: null },
        { condition: 'used', price: 70000, stock_quantity: 0, grade: null, condition_notes: null },
      ], error: null,
    })) } as unknown as SupabaseClient;
    const result = await buildMcpProductDetail({
      product: { ...product, has_variants: false, has_condition_offers: true },
      supabase, formatPrice: String, getSafeCatalogImageUrl: () => undefined,
    });

    expect(result.content[0].text).toContain('**Available Conditions:**');
    expect(result.content[0].text).toContain('• new: 100000 - In Stock');
    expect(result.content[0].text).not.toContain('• used: 70000');
    expect(result.structuredContent).toMatchObject({
      condition_offers: [
        { condition: 'new', availability: 'in_stock' },
        { condition: 'used', availability: 'out_of_stock' },
      ],
    });
  });

  it('keeps sold-out-only colors out of the available-option summary', async () => {
    const supabase = { rpc: vi.fn(async () => ({
      data: [
        { attributes: { color: 'Red', storage: '128GB' }, price_override: null, stock_quantity: 2, condition: 'new', images: [] },
        { attributes: { color: 'Blue', storage: '256GB' }, price_override: null, stock_quantity: 0, condition: 'new', images: [] },
      ],
      error: null,
    })) } as unknown as SupabaseClient;
    const result = await buildMcpProductDetail({
      product, supabase, formatPrice: String, getSafeCatalogImageUrl: () => undefined,
    });
    expect(result.content[0].text).toContain('**Available Colors:** Red');
    expect(result.content[0].text).toContain('**Storage Options:** 128GB');
    expect(result.content[0].text).not.toContain('Blue');
    expect(result.content[0].text).not.toContain('256GB');
    expect(result.structuredContent).toMatchObject({
      variants: [
        { availability: 'in_stock' },
        { availability: 'out_of_stock' },
      ],
    });
  });

  it('does not claim option availability when the public variant lookup fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const supabase = { rpc: vi.fn(async () => ({ data: null, error: { message: 'unavailable' } })) } as unknown as SupabaseClient;
    try {
      const result = await buildMcpProductDetail({
        product, supabase, formatPrice: String, getSafeCatalogImageUrl: () => undefined,
      });
      expect(result.content[0].text).toBe('Product variants are temporarily unavailable.');
      expect(result.structuredContent).toBeUndefined();
    } finally {
      error.mockRestore();
    }
  });
});
