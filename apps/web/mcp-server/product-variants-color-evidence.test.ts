import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { loadMcpProductVariants } from './product-variants';
import { MCP_OPTION_COLOR_EVIDENCE_GUIDANCE } from './option-color-evidence-guidance';
import { createSupabase } from './product-variants-test-fixtures';

describe('loadMcpProductVariants color evidence and lookup failures', () => {
  it('warns that an image filename cannot supply missing selectable color data', async () => {
    const supabase = createSupabase();
    supabase.rpc.mockResolvedValue({
      data: [
        {
          attributes: { ram: '4GB', storage: '128GB' },
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

    expect(result.content[0].text).toContain(
      MCP_OPTION_COLOR_EVIDENCE_GUIDANCE,
    );
    expect(result.content[0].text).not.toContain('**Colors:**');
    expect(result.structuredContent).toMatchObject({
      variants: [{ attributes: { ram: '4GB', storage: '128GB' } }],
    });
    expect(result.structuredContent?.variants?.[0]).not.toHaveProperty(
      'attributes.color',
    );
  });

  it.each([
    { key: 'Colour', value: 'Rose Gold' },
    { key: 'colour', value: 'Midnight Green' },
  ])('includes stocked legacy $key option values in Colors', async ({
    key,
    value,
  }) => {
    const supabase = createSupabase();
    const attributes = { [key]: value };
    supabase.rpc.mockResolvedValue({
      data: [{ attributes, price_override: null, stock_quantity: 2 }],
      error: null,
    });
    const result = await loadMcpProductVariants({
      args: { product_id: 'phone-1' },
      merchantId: 'merchant-1',
      supabase: supabase as unknown as SupabaseClient,
      sanitizeString: (input) => input,
      formatPrice: String,
    });

    expect(result.content[0].text).toContain(`**Colors:** ${value}`);
    expect(result.structuredContent?.variants?.[0]?.attributes).toEqual(
      attributes,
    );
  });

  it('does not claim availability when the public variant RPC fails', async () => {
    const supabase = createSupabase();
    supabase.rpc.mockResolvedValue({
      data: null,
      error: { message: 'unavailable' },
    });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = await loadMcpProductVariants({
        args: { product_id: 'phone-1' },
        merchantId: 'merchant-1',
        supabase: supabase as unknown as SupabaseClient,
        sanitizeString: (value) => value,
        formatPrice: String,
      });
      expect(result.content[0].text).toContain(
        'Product variants are temporarily unavailable.',
      );
      expect(result.content[0].text).toContain(
        'color is unconfirmed; do not guess.',
      );
      expect(result.structuredContent).toMatchObject({
        status: 'unavailable', variants: [], condition_offers: [],
        variant_lookup_failed: true, offer_lookup_failed: false,
        catalog_colors: { labels: [], source: null },
      });
    } finally {
      log.mockRestore();
    }
  });

  it('preserves the unavailable response when a declared offer lookup fails', async () => {
    const supabase = createSupabase();
    supabase.query.single.mockResolvedValue({
      data: {
        id: 'phone-1',
        name: 'Phone',
        manage_stock: true,
        has_variants: false,
        has_condition_offers: true,
      },
      error: null,
    });
    supabase.rpc.mockImplementation(async (name: string) =>
      name === 'get_product_offers'
        ? { data: null, error: { message: 'unavailable' } }
        : {
            data: [
              {
                attributes: { color: 'Red' },
                price_override: null,
                stock_quantity: 2,
              },
            ],
            error: null,
          },
    );
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = await loadMcpProductVariants({
        args: { product_id: 'phone-1' },
        merchantId: 'merchant-1',
        supabase: supabase as unknown as SupabaseClient,
        sanitizeString: (value) => value,
        formatPrice: String,
      });
      expect(result.content[0].text).toContain(
        'Product offers are temporarily unavailable.',
      );
      expect(result.content[0].text).toContain(
        'color is unconfirmed; do not guess.',
      );
      expect(result.structuredContent).toMatchObject({
        status: 'unavailable', variants: [], condition_offers: [],
        variant_lookup_failed: false, offer_lookup_failed: true,
        catalog_colors: { labels: [], source: null },
      });
      expect(supabase.rpc).not.toHaveBeenCalledWith(
        'get_storefront_product_variants',
        expect.anything(),
      );
    } finally {
      log.mockRestore();
    }
  });

  it('reports unconfirmed color when an option lookup returns no variants', async () => {
    const supabase = createSupabase();
    supabase.rpc.mockResolvedValue({ data: [], error: null });
    const result = await loadMcpProductVariants({
      args: { product_id: 'phone-1' },
      merchantId: 'merchant-1',
      supabase: supabase as unknown as SupabaseClient,
      sanitizeString: (value) => value,
      formatPrice: String,
    });

    expect(result.content[0].text).toContain(
      'No variant options were returned for "Phone".',
    );
    expect(result.content[0].text).toContain(
      'color is unconfirmed; do not guess.',
    );
    expect(result.structuredContent).toMatchObject({
      catalog_colors: { labels: [], source: null, images_by_color: {} },
      variants: [],
      condition_offers: [],
    });
  });

  it('keeps color unconfirmed when both variant and offer lookups fail', async () => {
    const supabase = createSupabase();
    supabase.query.single.mockResolvedValue({
      data: {
        id: 'phone-1',
        name: 'Phone',
        manage_stock: true,
        has_variants: true,
        has_condition_offers: true,
      },
      error: null,
    });
    supabase.rpc.mockResolvedValue({
      data: null,
      error: { message: 'unavailable' },
    });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = await loadMcpProductVariants({
        args: { product_id: 'phone-1' },
        merchantId: 'merchant-1',
        supabase: supabase as unknown as SupabaseClient,
        sanitizeString: (value) => value,
        formatPrice: String,
      });

      expect(result.content[0].text).toContain(
        'Product options are temporarily unavailable.',
      );
      expect(result.content[0].text).toContain(
        'color is unconfirmed; do not guess.',
      );
      expect(result.structuredContent).toMatchObject({
        status: 'unavailable', variants: [], condition_offers: [],
        variant_lookup_failed: true, offer_lookup_failed: true,
        catalog_colors: { labels: [], source: null },
      });
    } finally {
      log.mockRestore();
    }
  });

  it('includes color evidence guidance when the product lookup input sanitizes away', async () => {
    const supabase = createSupabase();
    const result = await loadMcpProductVariants({
      args: { product_id: 'invalid' },
      merchantId: 'merchant-1',
      supabase: supabase as unknown as SupabaseClient,
      sanitizeString: () => '',
      formatPrice: String,
    });

    expect(result.content[0].text).toContain(
      'Please provide a valid product ID or product name.',
    );
    expect(result.content[0].text).toContain(
      MCP_OPTION_COLOR_EVIDENCE_GUIDANCE,
    );
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('includes color evidence guidance when a product is not found', async () => {
    const supabase = createSupabase();
    supabase.query.single.mockResolvedValue({
      data: null,
      error: { code: 'PGRST116', message: 'not found' },
    });

    const result = await loadMcpProductVariants({
      args: { product_id: 'missing-product' },
      merchantId: 'merchant-1',
      supabase: supabase as unknown as SupabaseClient,
      sanitizeString: (value) => value,
      formatPrice: String,
    });

    expect(result.content[0].text).toContain(
      'Product "missing-product" not found.',
    );
    expect(result.content[0].text).toContain(
      MCP_OPTION_COLOR_EVIDENCE_GUIDANCE,
    );
  });
});
