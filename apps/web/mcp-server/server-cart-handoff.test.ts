import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { mcpToolOutputSchemas } from '../src/schemas/mcp-tool-output';
import { prepareCartHandoff } from './cart-handoff';
import { mcpServerTestSupport } from './server-test-support';

const { getResultRecord, postMcpJsonRpc, startMcpServerWithPostgrest } = mcpServerTestSupport;

describe('MCP cart handoff', () => {
  it('prepares a cart link only for an active product and does not claim the cart was saved', async () => {
    const server = await startMcpServerWithPostgrest({});
    try {
      const available = getResultRecord(
        await postMcpJsonRpc(server.baseUrl, {
          id: 3,
          method: 'tools/call',
          params: {
            name: 'prepare_storefront_cart_link',
            arguments: { product_id: 'available-product', quantity: 1 },
          },
        })
      );
      expect(available.structuredContent).toMatchObject({
        success: true,
        cart_url: 'https://ogabassey.com/cart?item_id=available-product&qty=1',
      });
      expect(JSON.stringify(available)).toContain('Add to cart on Ogabassey');
      expect(JSON.stringify(available)).not.toContain('added to cart');

      const soldOut = getResultRecord(
        await postMcpJsonRpc(server.baseUrl, {
          id: 5,
          method: 'tools/call',
          params: {
            name: 'prepare_storefront_cart_link',
            arguments: { product_id: 'sold-out-product', quantity: 1 },
          },
        })
      );
      expect(soldOut.structuredContent).toMatchObject({ success: false });
      expect(JSON.stringify(soldOut)).not.toContain('cart_url');

      const soldOutVariant = getResultRecord(
        await postMcpJsonRpc(server.baseUrl, {
          id: 6,
          method: 'tools/call',
          params: {
            name: 'prepare_storefront_cart_link',
            arguments: { product_id: 'variant-sold-out-product', quantity: 1 },
          },
        })
      );
      expect(soldOutVariant.structuredContent).toMatchObject({ success: false });

      const availableVariant = getResultRecord(
        await postMcpJsonRpc(server.baseUrl, {
          id: 7,
          method: 'tools/call',
          params: {
            name: 'prepare_storefront_cart_link',
            arguments: { product_id: 'variant-available-product', quantity: 1 },
          },
        })
      );
      expect(availableVariant.structuredContent).toMatchObject({
        success: false,
        requires_variant_selection: true,
        product_url: 'https://ogabassey.com/products/variant-available-phone',
      });
      expect(JSON.stringify(availableVariant)).not.toContain('cart_url');

      const sluglessVariant = getResultRecord(await postMcpJsonRpc(server.baseUrl, {
        id: 78,
        method: 'tools/call',
        params: { name: 'prepare_storefront_cart_link', arguments: { product_id: 'slugless-variant-product', quantity: 1 } },
      }));
      expect(sluglessVariant.structuredContent).toMatchObject({
        requires_variant_selection: true,
        product_url: 'https://ogabassey.com/products/slugless-variant-product',
      });

      const legacyStock = getResultRecord(await postMcpJsonRpc(server.baseUrl, {
        id: 70,
        method: 'tools/call',
        params: { name: 'prepare_storefront_cart_link', arguments: { product_id: 'legacy-stock-product', quantity: 3 } },
      }));
      expect(legacyStock.structuredContent).toMatchObject({ success: false });
      expect(JSON.stringify(legacyStock)).not.toContain('cart_url');
      const insufficientLegacyStock = getResultRecord(await postMcpJsonRpc(server.baseUrl, {
        id: 73, method: 'tools/call',
        params: { name: 'prepare_storefront_cart_link', arguments: { product_id: 'legacy-stock-product', quantity: 4 } },
      }));
      expect(insufficientLegacyStock.structuredContent).toMatchObject({ success: false });
      expect(JSON.stringify(insufficientLegacyStock)).not.toContain('cart_url');

      const conditionOffer = getResultRecord(await postMcpJsonRpc(server.baseUrl, {
        id: 71,
        method: 'tools/call',
        params: { name: 'prepare_storefront_cart_link', arguments: { product_id: 'condition-offer-product', quantity: 1 } },
      }));
      expect(conditionOffer.structuredContent).toMatchObject({
        success: false,
        requires_variant_selection: true,
        product_url: 'https://ogabassey.com/products/used-offer-phone',
      });
      expect(JSON.stringify(conditionOffer)).not.toContain('cart_url');

      const soldOutOffer = getResultRecord(await postMcpJsonRpc(server.baseUrl, {
        id: 74, method: 'tools/call',
        params: { name: 'prepare_storefront_cart_link', arguments: { product_id: 'condition-offer-sold-out-product', quantity: 1 } },
      }));
      expect(soldOutOffer.structuredContent).toMatchObject({ success: false });
      expect(JSON.stringify(soldOutOffer)).not.toContain('requires_variant_selection');

      const combinedOptions = getResultRecord(await postMcpJsonRpc(server.baseUrl, {
        id: 79, method: 'tools/call',
        params: { name: 'prepare_storefront_cart_link', arguments: { product_id: 'combined-options-product', quantity: 1 } },
      }));
      expect(combinedOptions.structuredContent).toMatchObject({
        requires_variant_selection: true,
        product_url: 'https://ogabassey.com/products/combined-options-phone',
      });

      const insufficientCombinedOptions = getResultRecord(await postMcpJsonRpc(server.baseUrl, {
        id: 80, method: 'tools/call',
        params: { name: 'prepare_storefront_cart_link', arguments: { product_id: 'combined-options-product', quantity: 3 } },
      }));
      expect(insufficientCombinedOptions.structuredContent).toMatchObject({ success: false });
      expect(JSON.stringify(insufficientCombinedOptions)).not.toContain('requires_variant_selection');

      const insufficientOfferQuantity = getResultRecord(await postMcpJsonRpc(server.baseUrl, {
        id: 75, method: 'tools/call',
        params: { name: 'prepare_storefront_cart_link', arguments: { product_id: 'condition-offer-product', quantity: 3 } },
      }));
      expect(insufficientOfferQuantity.structuredContent).toMatchObject({ success: false });
      expect(JSON.stringify(insufficientOfferQuantity)).not.toContain('requires_variant_selection');

      const stockedParentOffer = getResultRecord(await postMcpJsonRpc(server.baseUrl, {
        id: 76, method: 'tools/call',
        params: { name: 'prepare_storefront_cart_link', arguments: { product_id: 'condition-offer-parent-stock-product', quantity: 2 } },
      }));
      expect(stockedParentOffer.structuredContent).toMatchObject({ requires_variant_selection: true });

      const fractionalQuantity = getResultRecord(await postMcpJsonRpc(server.baseUrl, {
        id: 77, method: 'tools/call',
        params: { name: 'prepare_storefront_cart_link', arguments: { product_id: 'available-product', quantity: 1.5 } },
      }));
      expect(fractionalQuantity.isError).toBe(true);
      expect(JSON.stringify(fractionalQuantity)).not.toContain('cart_url');

      const insufficientVariantQuantity = getResultRecord(
        await postMcpJsonRpc(server.baseUrl, {
          id: 8,
          method: 'tools/call',
          params: {
            name: 'prepare_storefront_cart_link',
            arguments: { product_id: 'variant-available-product', quantity: 3 },
          },
        })
      );
      expect(insufficientVariantQuantity.structuredContent).toMatchObject({ success: false });

      const unavailable = getResultRecord(
        await postMcpJsonRpc(server.baseUrl, {
          id: 4,
          method: 'tools/call',
          params: {
            name: 'prepare_storefront_cart_link',
            arguments: { product_id: 'missing-product', quantity: 1 },
          },
        })
      );
      expect(unavailable.structuredContent).toMatchObject({ success: false });
      expect(JSON.stringify(unavailable)).not.toContain('cart_url');
    } finally {
      await server.close();
    }
  });

  it.each([false, true])('downgrades null-name catalog rows with has_variants=%s to a safe cart error', async (hasVariants) => {
    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      single: vi.fn(async () => ({
        data: { name: null, slug: 'null-name', price: 100, manage_stock: false, stock_quantity: 0, has_variants: hasVariants, has_condition_offers: false },
        error: null,
      })),
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    const supabase = { from: vi.fn(() => query), rpc: vi.fn() } as unknown as SupabaseClient;
    const result = await prepareCartHandoff({
      supabase, merchantId: 'merchant-1', productId: 'null-name-product', quantity: 1, formatPrice: String,
    });
    expect(result.content[0].text).not.toContain('null');
    expect(result.structuredContent).toMatchObject({ success: false, message: 'Unable to prepare cart link.' });
    expect(mcpToolOutputSchemas.prepare_storefront_cart_link.safeParse(result.structuredContent).success).toBe(true);
  });
  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])('rejects corrupt simple-product price %s before formatting', async (price) => {
    const query = { select: vi.fn(), eq: vi.fn(), single: vi.fn(async () => ({ data: { name: 'Phone', slug: 'phone', price, manage_stock: false, stock_quantity: 0, has_variants: false, has_condition_offers: false }, error: null })) };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    const formatPrice = vi.fn(String);
    const result = await prepareCartHandoff({ supabase: { from: vi.fn(() => query), rpc: vi.fn() } as unknown as SupabaseClient, merchantId: 'merchant-1', productId: 'phone-1', quantity: 1, formatPrice });
    expect(result.structuredContent).toMatchObject({ success: false, message: 'Unable to prepare cart link.' });
    expect(result.structuredContent).not.toHaveProperty('cart_url');
    expect(formatPrice).not.toHaveBeenCalled();
    expect(mcpToolOutputSchemas.prepare_storefront_cart_link.safeParse(result.structuredContent).success).toBe(true);
  });

  it('preserves a zero-price simple-product handoff', async () => {
    const query = { select: vi.fn(), eq: vi.fn(), single: vi.fn(async () => ({ data: { name: 'Phone', slug: 'phone', price: 0, manage_stock: false, stock_quantity: 0, has_variants: false, has_condition_offers: false }, error: null })) };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    const result = await prepareCartHandoff({ supabase: { from: vi.fn(() => query), rpc: vi.fn() } as unknown as SupabaseClient, merchantId: 'merchant-1', productId: 'phone-1', quantity: 1, formatPrice: String });
    expect(result.structuredContent).toMatchObject({ success: true, quantity: 1 });
  });

  it('marks corrupt simple-product stock unavailable instead of comparing NaN', async () => {
    const query = { select: vi.fn(), eq: vi.fn(), single: vi.fn(async () => ({ data: { name: 'Phone', slug: 'phone', price: 100, manage_stock: true, stock_quantity: 'plenty', has_variants: false, has_condition_offers: false }, error: null })) };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    const result = await prepareCartHandoff({ supabase: { from: vi.fn(() => query), rpc: vi.fn() } as unknown as SupabaseClient, merchantId: 'merchant-1', productId: 'phone-1', quantity: 1, formatPrice: String });
    expect(result.structuredContent).toMatchObject({ success: false });
    expect(result.structuredContent).not.toHaveProperty('cart_url');
    expect(mcpToolOutputSchemas.prepare_storefront_cart_link.safeParse(result.structuredContent).success).toBe(true);
  });

  it.each([0, 11, 1.5, Number.NaN])('rejects out-of-range quantity %s before touching catalog stock', async (quantity) => {
    const supabase = { from: vi.fn(), rpc: vi.fn() } as unknown as SupabaseClient;
    const result = await prepareCartHandoff({
      supabase, merchantId: 'merchant-1', productId: 'any-product', quantity, formatPrice: String,
    });
    expect(result.structuredContent).toMatchObject({ success: false, message: 'Unable to prepare cart link.' });
    expect(mcpToolOutputSchemas.prepare_storefront_cart_link.safeParse(result.structuredContent).success).toBe(true);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('serves the pre-rename add_to_cart name from the same handler', async () => {
    const server = await startMcpServerWithPostgrest({});
    try {
      const result = getResultRecord(
        await postMcpJsonRpc(server.baseUrl, {
          id: 90,
          method: 'tools/call',
          params: {
            name: 'add_to_cart',
            arguments: { product_id: 'available-product', quantity: 1 },
          },
        })
      );
      expect(result.structuredContent).toMatchObject({
        success: true,
        cart_url: 'https://ogabassey.com/cart?item_id=available-product&qty=1',
      });
      expect(mcpToolOutputSchemas.prepare_storefront_cart_link.safeParse(result.structuredContent).success).toBe(true);
    } finally {
      await server.close();
    }
  });

});
