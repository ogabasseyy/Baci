import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { buildMcpProductDetail } from './product-detail';
import { MCP_OPTION_COLOR_EVIDENCE_GUIDANCE } from './option-color-evidence-guidance';

const product = {
  id: 'option-phone', name: 'Option Phone', slug: null, price: 100000,
  compare_at_price: null, images: [], description: null, stock_quantity: 0,
  manage_stock: true, condition: 'new', condition_detail: null, brand: null,
  category: null, has_variants: true, has_condition_offers: false, schema_markup: null,
};

describe('buildMcpProductDetail', () => {
  it('shows a stocked variant price instead of an unavailable parent price', async () => {
    const supabase = { rpc: vi.fn(async () => ({ data: [
      { attributes: { storage: '128GB' }, price_override: 90000, stock_quantity: 2, condition: 'new', images: [] },
    ], error: null })) } as unknown as SupabaseClient;
    const result = await buildMcpProductDetail({
      product, supabase, formatPrice: String, getSafeCatalogImageUrl: () => undefined, merchantId: 'merchant-1',
    });

    expect(result.structuredContent).toMatchObject({ products: [{ price: 90000, in_stock: true }] });
    expect(result.content[0].text).toContain('**Price:** 90000');
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
      product, supabase, formatPrice: String, getSafeCatalogImageUrl: () => undefined, merchantId: 'merchant-1',
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

  it.each([
    { key: 'Colour', value: 'Rose Gold' },
    { key: 'colour', value: 'Midnight Green' },
  ])('includes stocked legacy $key option values in Available Colors', async ({ key, value }) => {
    const attributes = { [key]: value };
    const supabase = { rpc: vi.fn(async () => ({
      data: [{ attributes, price_override: null, stock_quantity: 2, condition: 'new', images: [] }],
      error: null,
    })) } as unknown as SupabaseClient;
    const result = await buildMcpProductDetail({
      product, supabase, formatPrice: String, getSafeCatalogImageUrl: () => undefined, merchantId: 'merchant-1',
    });

    expect(result.content[0].text).toContain(`**Available Colors:** ${value}`);
    expect(result.structuredContent).toMatchObject({ variants: [{ attributes }] });
  });

  it('does not infer selectable color from a Midnight Black product image filename', async () => {
    const supabase = { rpc: vi.fn(async () => ({
      data: [{
        attributes: { ram: '4GB', storage: '128GB' },
        price_override: null,
        stock_quantity: 2,
        condition: 'new',
        images: [],
      }],
      error: null,
    })) } as unknown as SupabaseClient;
    const result = await buildMcpProductDetail({
      product: {
        ...product,
        name: 'Redmi 15C 5G',
        images: ['https://cdn.example/redmi-15-midnight-black.avif'],
      },
      supabase,
      formatPrice: String,
      getSafeCatalogImageUrl: (url) => url ?? undefined, merchantId: 'merchant-1',
    });

    expect(result.content[0].text).toContain(
      MCP_OPTION_COLOR_EVIDENCE_GUIDANCE
    );
    expect(result.content[0].text).not.toContain('**Available Colors:**');
    expect(result.content[0].text).not.toContain('Midnight Black');
    expect(result.structuredContent).toMatchObject({
      products: [{ image: 'https://cdn.example/redmi-15-midnight-black.avif' }],
      variants: [{ attributes: { ram: '4GB', storage: '128GB' } }],
    });
    expect(result.structuredContent?.variants?.[0]).not.toHaveProperty('attributes.color');
  });

  it('returns stored color image labels with safe images without asserting a color variant', async () => {
    const result = await buildMcpProductDetail({
      product: {
        ...product,
        has_variants: false,
        color_images: { Graphite: ['https://cdn.example/graphite.jpg'] },
      },
      supabase: { rpc: vi.fn() } as unknown as SupabaseClient,
      formatPrice: String,
      getSafeCatalogImageUrl: (url) => url?.startsWith('https://') ? url : undefined, merchantId: 'merchant-1',
    });

    expect(result.content[0].text).toContain('**Catalog Colors:** Graphite');
    expect(result.content[0].text).toContain('stored catalog color choices');
    expect(result.structuredContent).toMatchObject({
      catalog_colors: {
        labels: ['Graphite'], source: 'product.color_images',
        images_by_color: { Graphite: ['https://cdn.example/graphite.jpg'] },
      },
      variants: [],
    });
  });

  it('keeps catalog colors distinct from stock when variants expose storage only', async () => {
    const supabase = { rpc: vi.fn(async () => ({ data: [
      { attributes: { storage: '128GB' }, price_override: null, stock_quantity: 2, condition: 'new', images: [] },
    ], error: null })) } as unknown as SupabaseClient;
    const result = await buildMcpProductDetail({
      product: { ...product, color_images: { Silver: ['https://cdn.example/silver.jpg'] } },
      supabase, formatPrice: String, getSafeCatalogImageUrl: (url) => url ?? undefined, merchantId: 'merchant-1',
    });

    expect(result.content[0].text).toContain('**Catalog Colors:** Silver');
    expect(result.content[0].text).toContain('**Storage Options:** 128GB');
    expect(result.content[0].text).not.toContain('Available Colors:');
    expect(result.structuredContent).toMatchObject({
      catalog_colors: { labels: ['Silver'] },
      variants: [{ attributes: { storage: '128GB' }, availability: 'in_stock' }],
    });
  });

  it('keeps malformed and empty color mappings unknown', async () => {
    for (const color_images of [null, [], 'bad', {}]) {
      const result = await buildMcpProductDetail({
        product: { ...product, has_variants: false, color_images },
        supabase: { rpc: vi.fn() } as unknown as SupabaseClient,
        formatPrice: String, getSafeCatalogImageUrl: () => undefined, merchantId: 'merchant-1',
      });
      expect(result.structuredContent).toMatchObject({
        catalog_colors: { labels: [], source: null, images_by_color: {} },
      });
      expect(result.content[0].text).not.toContain('**Catalog Colors:**');
    }
  });

  it('does not claim option availability when the public variant lookup fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const supabase = { rpc: vi.fn(async () => ({ data: null, error: { message: 'unavailable' } })) } as unknown as SupabaseClient;
    try {
      const result = await buildMcpProductDetail({
        product: { ...product, description: 'Useful phone', images: ['https://cdn.example/phone.jpg'] },
        supabase, formatPrice: String, getSafeCatalogImageUrl: () => 'https://cdn.example/phone.jpg', merchantId: 'merchant-1',
      });
      expect(result.content[0].text).toContain('Useful phone');
      expect(result.content[0].text).toContain('Variant options are temporarily unavailable.');
      expect(result.structuredContent).toMatchObject({
        products: [{ name: 'Option Phone', price: 100000, image: 'https://cdn.example/phone.jpg',
          in_stock: null, stock_confidence: 'unconfirmed' }],
        variant_lookup_failed: true,
      });
    } finally {
      error.mockRestore();
    }
  });

  it('keeps product details with unconfirmed availability when its only offer lookup fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const supabase = { rpc: vi.fn(async () => ({ data: null, error: { message: 'unavailable' } })) } as unknown as SupabaseClient;
    try {
      const result = await buildMcpProductDetail({
        product: { ...product, description: 'Useful phone', has_variants: false, has_condition_offers: true },
        supabase, formatPrice: String, getSafeCatalogImageUrl: () => undefined, merchantId: 'merchant-1',
      });
      expect(result.content[0].text).toContain('Useful phone');
      expect(result.content[0].text).toContain('Condition offers are temporarily unavailable.');
      expect(result.structuredContent).toMatchObject({
        products: [{ name: 'Option Phone', price: 100000, in_stock: null,
          stock_confidence: 'unconfirmed' }],
        offer_lookup_failed: true,
      });
    } finally {
      error.mockRestore();
    }
  });
});
