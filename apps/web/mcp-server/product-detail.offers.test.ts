import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { buildMcpProductDetail } from './product-detail';

const product = {
  id: 'option-phone', name: 'Option Phone', slug: null, price: 100000,
  compare_at_price: null, images: [], description: null, stock_quantity: 0,
  manage_stock: true, condition: 'new', condition_detail: null, brand: null,
  category: null, has_variants: true, has_condition_offers: false, schema_markup: null,
};

describe('buildMcpProductDetail offer authority', () => {
  it('scopes the offer-resolution call to the merchant like the variants surface', async () => {
    const rpc = vi.fn(async () => ({ data: [], error: null }));
    await buildMcpProductDetail({
      product: { ...product, has_variants: false, has_condition_offers: true },
      supabase: { rpc } as unknown as SupabaseClient,
      formatPrice: String, getSafeCatalogImageUrl: () => undefined, merchantId: 'merchant-1',
    });
    expect(rpc).toHaveBeenCalledWith('get_storefront_offer_resolution', { p_merchant_id: 'merchant-1', p_product_ids: [product.id] });
  });

  it('keeps product details and stocked offers when the variant lookup fails', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const rpc = vi.fn(async (name: string) => name === 'get_storefront_product_variants'
      ? { data: null, error: { message: 'variants unavailable' } }
      : { data: [{ product_id: 'option-phone', offer_id: 'offer-used', condition: 'used', price_basis: 70000, allocatable_stock: 2, parent_eligible: true, grade: null, condition_notes: null }], error: null });
    try {
      const result = await buildMcpProductDetail({
        product: { ...product, description: 'A useful phone', has_condition_offers: true },
        supabase: { rpc } as unknown as SupabaseClient,
        formatPrice: String, getSafeCatalogImageUrl: () => undefined, merchantId: 'merchant-1',
      });
      expect(rpc).toHaveBeenCalledWith('get_storefront_offer_resolution', { p_merchant_id: 'merchant-1', p_product_ids: [product.id] });
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
    const rpc = vi.fn(async (name: string) => name === 'get_storefront_offer_resolution'
      ? { data: null, error: { message: 'offers unavailable' } }
      : { data: [{ attributes: { color: 'Red' }, price_override: null, stock_quantity: 2, condition: 'new', images: [] }], error: null });
    try {
      const result = await buildMcpProductDetail({
        product: { ...product, has_condition_offers: true },
        supabase: { rpc } as unknown as SupabaseClient,
        formatPrice: String, getSafeCatalogImageUrl: () => undefined, merchantId: 'merchant-1',
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
        { product_id: 'option-phone', offer_id: 'offer-new', condition: 'new', price_basis: 100000, allocatable_stock: 2, parent_eligible: true, grade: null, condition_notes: null },
        { product_id: 'option-phone', offer_id: 'offer-used', condition: 'used', price_basis: 70000, allocatable_stock: 0, parent_eligible: true, grade: null, condition_notes: null },
      ], error: null,
    })) } as unknown as SupabaseClient;
    const result = await buildMcpProductDetail({
      product: { ...product, has_variants: false, has_condition_offers: true },
      supabase, formatPrice: String, getSafeCatalogImageUrl: () => undefined, merchantId: 'merchant-1',
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

  it('shows the stocked offer price when base inventory is unavailable', async () => {
    const supabase = { rpc: vi.fn(async () => ({ data: [
      { product_id: 'option-phone', offer_id: 'offer-used', condition: 'used', price_basis: 80000, allocatable_stock: 2, parent_eligible: true, grade: null, condition_notes: null },
    ], error: null })) } as unknown as SupabaseClient;
    const result = await buildMcpProductDetail({
      product: { ...product, has_variants: false, has_condition_offers: true, compare_at_price: 120000 },
      supabase, formatPrice: String, getSafeCatalogImageUrl: () => undefined, merchantId: 'merchant-1',
    });

    expect(result.structuredContent).toMatchObject({
      products: [{ price: 80000, compare_at_price: null, base_compare_at_price: 120000, in_stock: true, condition: 'used' }],
    });
    expect(result.content[0].text).toContain('**Price:** 80000');
    expect(result.content[0].text).toContain('**Condition:** used');
    expect(result.content[0].text).not.toContain('120000');
  });

  it('skips stocked offers without a finite price instead of pricing them at zero', async () => {
    const supabase = { rpc: vi.fn(async () => ({ data: [
      { product_id: 'option-phone', offer_id: 'offer-new', condition: 'new', price_basis: 100000, allocatable_stock: 2, parent_eligible: true, grade: null, condition_notes: null },
      { product_id: 'option-phone', offer_id: 'offer-used', condition: 'used', price_basis: null, allocatable_stock: 2, parent_eligible: true, grade: null, condition_notes: null },
    ], error: null })) } as unknown as SupabaseClient;
    const result = await buildMcpProductDetail({
      product: { ...product, has_variants: false, has_condition_offers: true },
      supabase, formatPrice: String, getSafeCatalogImageUrl: () => undefined, merchantId: 'merchant-1',
    });

    expect(result.content[0].text).toContain('• new: 100000 - In Stock');
    expect(result.content[0].text).not.toContain('• used:');
    expect(result.content[0].text).toContain('**Price:** 100000');
    expect(result.content[0].text).not.toContain('**Price:** 0');
    expect(result.structuredContent).toMatchObject({
      condition_offers: [{ condition: 'new', availability: 'in_stock' }],
    });
  });

  it('drops a gated row a partial projection still carries', async () => {
    const supabase = { rpc: vi.fn(async () => ({ data: [
      { product_id: 'option-phone', offer_id: 'offer-new', condition: 'new', price_basis: 100000, allocatable_stock: 2, parent_eligible: true, grade: null, condition_notes: null },
      { product_id: 'option-phone', offer_id: 'offer-used', condition: 'used', price_basis: 70000, allocatable_stock: 2, parent_eligible: false, grade: null, condition_notes: null },
    ], error: null })) } as unknown as SupabaseClient;
    const result = await buildMcpProductDetail({
      product: { ...product, has_variants: false, has_condition_offers: true },
      supabase, formatPrice: String, getSafeCatalogImageUrl: () => undefined, merchantId: 'merchant-1',
    });

    expect(result.content[0].text).toContain('• new: 100000 - In Stock');
    expect(result.content[0].text).not.toContain('• used:');
    expect(result.structuredContent).toMatchObject({
      condition_offers: [{ condition: 'new', availability: 'in_stock' }],
    });
  });

  it('fails closed to zero when a non-unlimited policy has no allocation', async () => {
    const supabase = { rpc: vi.fn(async () => ({ data: [
      { product_id: 'option-phone', offer_id: 'offer-used', condition: 'used', price_basis: 70000, allocatable_stock: null, effective_policy: 'legacy', parent_eligible: true, grade: null, condition_notes: null },
    ], error: null })) } as unknown as SupabaseClient;
    const result = await buildMcpProductDetail({
      product: { ...product, has_variants: false, has_condition_offers: true },
      supabase, formatPrice: String, getSafeCatalogImageUrl: () => undefined, merchantId: 'merchant-1',
    });

    expect(result.content[0].text).not.toContain('• used: 70000 - In Stock');
    expect(result.structuredContent).toMatchObject({
      condition_offers: [{ condition: 'used', availability: 'out_of_stock' }],
    });
  });

  it('treats unlimited null allocations as unbounded', async () => {
    const supabase = { rpc: vi.fn(async () => ({ data: [
      { product_id: 'option-phone', offer_id: 'offer-used', condition: 'used', price_basis: 70000, allocatable_stock: null, effective_policy: 'serialized_then_unlimited', parent_eligible: true, grade: null, condition_notes: null },
    ], error: null })) } as unknown as SupabaseClient;
    const result = await buildMcpProductDetail({
      product: { ...product, has_variants: false, has_condition_offers: true },
      supabase, formatPrice: String, getSafeCatalogImageUrl: () => undefined, merchantId: 'merchant-1',
    });

    expect(result.content[0].text).toContain('• used: 70000 - In Stock');
    expect(result.structuredContent).toMatchObject({
      condition_offers: [{ condition: 'used', availability: 'in_stock' }],
    });
  });

  it('matches an uppercase caller id to a lowercase live row', async () => {
    const supabase = { rpc: vi.fn(async () => ({ data: [
      { product_id: 'option-phone', offer_id: 'offer-used', condition: 'used', price_basis: 70000, allocatable_stock: 2, parent_eligible: true, grade: null, condition_notes: null },
    ], error: null })) } as unknown as SupabaseClient;
    const result = await buildMcpProductDetail({
      product: { ...product, id: 'OPTION-PHONE', has_variants: false, has_condition_offers: true },
      supabase, formatPrice: String, getSafeCatalogImageUrl: () => undefined, merchantId: 'merchant-1',
    });

    expect(result.content[0].text).toContain('• used: 70000 - In Stock');
    expect(result.structuredContent).toMatchObject({
      condition_offers: [{ condition: 'used', availability: 'in_stock' }],
    });
  });
});
