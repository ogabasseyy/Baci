import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { mcpToolOutputSchemas } from '../src/schemas/mcp-tool-output';
import { loadMcpProductVariants } from './product-variants';
import { buildMcpProductDetail } from './product-detail';
import { createSupabase } from './product-variants-test-fixtures';

describe('variant output failure contracts', () => {
  it.each(['outage', 'empty', 'success'])('omits a corrupt null product name from %s option results', async (mode) => {
    const supabase = createSupabase();
    supabase.query.single.mockResolvedValue({ data: { id: 'phone-1', name: null, manage_stock: true, has_variants: true, has_condition_offers: false, color: null, color_images: null }, error: null });
    if (mode === 'outage') supabase.rpc.mockResolvedValue({ data: null, error: { message: 'Fixture unavailable' } });
    if (mode === 'empty') supabase.rpc.mockResolvedValue({ data: [], error: null });
    const result = await loadMcpProductVariants({ args: { product_id: 'phone-1' }, merchantId: 'merchant-1', supabase: supabase as unknown as SupabaseClient, sanitizeString: (value) => value, formatPrice: String });
    if (mode === 'outage') expect(result.structuredContent).toMatchObject({ status: 'unavailable', variants: [] });
    expect(result.content[0].text).not.toContain('null');
    if (mode === 'success') expect(result.structuredContent?.variants).toHaveLength(1);
    expect(result.structuredContent).not.toHaveProperty('product_name');
    expect(mcpToolOutputSchemas.get_product_variants.safeParse(result.structuredContent).success).toBe(true);
  });

  it('validates numeric JSON attributes passed through both option handlers', async () => {
    const supabase = createSupabase();
    supabase.rpc.mockResolvedValue({ data: [{ attributes: { ram: 8, storage: { gb: 256 } }, price_override: null, stock_quantity: 2, condition: 'new', images: [] }], error: null });
    const variants = await loadMcpProductVariants({
      args: { product_id: 'phone-1' }, merchantId: 'merchant-1',
      supabase: supabase as unknown as SupabaseClient,
      sanitizeString: (value) => value, formatPrice: String,
    });
    const detail = await buildMcpProductDetail({
      product: { id: 'phone-1', name: 'Phone', slug: null, price: 100000, compare_at_price: null, images: [], description: null, stock_quantity: 0, manage_stock: true, condition: 'new', condition_detail: null, brand: null, category: null, has_variants: true, has_condition_offers: false, schema_markup: null },
      supabase: supabase as unknown as SupabaseClient,
      formatPrice: String, getSafeCatalogImageUrl: () => undefined,
    });
    expect(variants.structuredContent).toMatchObject({ variants: [{ attributes: { ram: 8 } }] });
    expect(detail.structuredContent).toMatchObject({ variants: [{ attributes: { ram: 8 } }] });
    expect(variants.structuredContent).toMatchObject({ variants: [{ attributes: { storage: { gb: 256 } } }] });
    expect(mcpToolOutputSchemas.get_product_variants.safeParse(variants.structuredContent).success).toBe(true);
    expect(mcpToolOutputSchemas.get_product.safeParse(detail.structuredContent).success).toBe(true);
    expect(variants.content[0].text).not.toContain('[object Object]');
    expect(detail.content[0].text).not.toContain('[object Object]');
  });

  it.each([
    { label: 'negative variant price', offer: false, row: { attributes: {}, price_override: -1, stock_quantity: 2, condition: 'new', images: [] } },
    { label: 'missing tracked stock', offer: false, row: { attributes: {}, price_override: null, condition: 'new', images: [] } },
    { label: 'negative offer price', offer: true, row: { condition: 'new', price: -1, stock_quantity: 2, grade: null, condition_notes: null } },
    { label: 'negative variant stock', offer: false, row: { attributes: {}, price_override: null, stock_quantity: -3, condition: 'new', images: [] } },
    { label: 'negative offer stock', offer: true, row: { condition: 'new', price: 100, stock_quantity: -3, grade: null, condition_notes: null } },
  ])('returns truthful unavailable results for $label', async ({ offer, row }) => {
    const supabase = createSupabase();
    supabase.query.single.mockResolvedValue({ data: { id: 'phone-1', name: 'Phone', manage_stock: true, has_variants: !offer, has_condition_offers: offer, color: null, color_images: null }, error: null });
    supabase.rpc.mockResolvedValue({ data: [row], error: null });
    const variants = await loadMcpProductVariants({
      args: { product_id: 'phone-1' }, merchantId: 'merchant-1', supabase: supabase as unknown as SupabaseClient,
      sanitizeString: (value) => value, formatPrice: String,
    });
    const detail = await buildMcpProductDetail({
      product: { id: 'phone-1', name: 'Phone', slug: null, price: 100000, compare_at_price: null, images: [], description: null, stock_quantity: 0, manage_stock: true, condition: 'new', condition_detail: null, brand: null, category: null, has_variants: !offer, has_condition_offers: offer, schema_markup: null },
      supabase: supabase as unknown as SupabaseClient, formatPrice: String, getSafeCatalogImageUrl: () => undefined,
    });
    expect(variants.structuredContent).toMatchObject({ status: 'unavailable', variants: [], condition_offers: [] });
    expect(detail.structuredContent).toMatchObject({ status: 'unavailable', products: [] });
    expect(mcpToolOutputSchemas.get_product_variants.safeParse(variants.structuredContent).success).toBe(true);
    expect(mcpToolOutputSchemas.get_product.safeParse(detail.structuredContent).success).toBe(true);
    expect(variants.content[0].text).not.toContain('-1');
    expect(detail.content[0].text).not.toContain('-1');
  });

  it('explicitly reports successful lookups when neither returns options', async () => {
    const supabase = createSupabase();
    supabase.rpc.mockResolvedValue({ data: [], error: null });
    const result = await loadMcpProductVariants({
      args: { product_id: 'phone-1' }, merchantId: 'merchant-1',
      supabase: supabase as unknown as SupabaseClient,
      sanitizeString: (value) => value, formatPrice: String,
    });
    expect(result.structuredContent).toMatchObject({ variants: [], condition_offers: [], status: 'empty', variant_lookup_failed: false, offer_lookup_failed: false });
  });
  it('distinguishes an option lookup failure from no listed options, even without colors', async () => {
    const supabase = createSupabase();
    supabase.rpc.mockResolvedValue({ data: null, error: { message: 'Fixture unavailable' } });
    const result = await loadMcpProductVariants({
      args: { product_id: 'phone-1' }, merchantId: 'merchant-1',
      supabase: supabase as unknown as SupabaseClient,
      sanitizeString: (value) => value, formatPrice: String,
    });
    expect(result.structuredContent).toMatchObject({
      status: 'unavailable', variant_lookup_failed: true, variants: [], condition_offers: [],
      catalog_colors: { labels: [], source: null },
    });
    expect(mcpToolOutputSchemas.get_product_variants.safeParse(result.structuredContent).success).toBe(true);
  });

  it('returns a structured invalid-input result without querying the catalog', async () => {
    const supabase = createSupabase();
    const result = await loadMcpProductVariants({
      args: {}, merchantId: 'merchant-1', supabase: supabase as unknown as SupabaseClient,
      sanitizeString: (value) => value, formatPrice: String,
    });
    expect(result.structuredContent).toMatchObject({ status: 'invalid_input', message: 'Please provide a valid product ID or product name.', variants: [], condition_offers: [] });
    expect(supabase.from).not.toHaveBeenCalled();
    expect(mcpToolOutputSchemas.get_product_variants.safeParse(result.structuredContent).success).toBe(true);
  });
  it.each([null, Number.NaN, Number.POSITIVE_INFINITY, -1])('rejects corrupt tracked base stock %s', async (stock) => {
    const result = await buildMcpProductDetail({ product: { id: 'phone-1', name: 'Phone', slug: null, price: 100, compare_at_price: null, images: [], description: null, stock_quantity: stock, manage_stock: true, condition: 'new', condition_detail: null, brand: null, category: null, has_variants: false, has_condition_offers: false, schema_markup: null }, supabase: createSupabase() as unknown as SupabaseClient, formatPrice: String, getSafeCatalogImageUrl: () => undefined });
    expect(result.structuredContent).toMatchObject({ status: 'unavailable', products: [] });
    expect(mcpToolOutputSchemas.get_product.safeParse(result.structuredContent).success).toBe(true);
  });

  it.each([{ stock: 0, tracked: true }, { stock: null, tracked: false }])('preserves base-stock boundary $stock with tracking=$tracked', async ({ stock, tracked }) => {
    const result = await buildMcpProductDetail({ product: { id: 'phone-1', name: 'Phone', slug: null, price: 100, compare_at_price: null, images: [], description: null, stock_quantity: stock, manage_stock: tracked, condition: 'new', condition_detail: null, brand: null, category: null, has_variants: false, has_condition_offers: false, schema_markup: null }, supabase: createSupabase() as unknown as SupabaseClient, formatPrice: String, getSafeCatalogImageUrl: () => undefined });
    expect(result.structuredContent.products).toHaveLength(1);
    expect(mcpToolOutputSchemas.get_product.safeParse(result.structuredContent).success).toBe(true);
  });

  it.each([null, 0, 100])('reports detail price %s without inventing a zero', async (price) => {
    const result = await buildMcpProductDetail({ product: { id: 'phone-1', name: 'Phone', slug: null, price: price as unknown as number, compare_at_price: 200, images: [], description: null, stock_quantity: null, manage_stock: false, condition: 'new', condition_detail: null, brand: null, category: null, has_variants: false, has_condition_offers: false, schema_markup: null }, supabase: createSupabase() as unknown as SupabaseClient, formatPrice: (value) => `NGN ${Number(value)}`, getSafeCatalogImageUrl: () => undefined });
    expect(result.structuredContent.products).toMatchObject([{ price }]);
    expect(mcpToolOutputSchemas.get_product.safeParse(result.structuredContent).success).toBe(true);
    if (price === null) {
      expect(result.content[0].text).toContain('**Price:** Price unconfirmed');
      expect(result.content[0].text).not.toContain('NGN 0');
      expect(result.content[0].text).not.toContain('% off');
    } else {
      expect(result.content[0].text).toContain(`**Price:** NGN ${price}`);
    }
  });

});
