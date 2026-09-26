import { describe, expect, it } from 'vitest';
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
            name: 'add_to_cart',
            arguments: { product_id: 'available-product', quantity: 1 },
          },
        })
      );
      expect(available.structuredContent).toMatchObject({
        success: true,
        cart_url: 'https://ogabassey.com/cart?item_id=available-product&qty=1',
      });
      expect(JSON.stringify(available)).toContain('Cart link ready');
      expect(JSON.stringify(available)).not.toContain('added to cart');

      const soldOut = getResultRecord(
        await postMcpJsonRpc(server.baseUrl, {
          id: 5,
          method: 'tools/call',
          params: {
            name: 'add_to_cart',
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
            name: 'add_to_cart',
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
            name: 'add_to_cart',
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

      const legacyStock = getResultRecord(await postMcpJsonRpc(server.baseUrl, {
        id: 70,
        method: 'tools/call',
        params: { name: 'add_to_cart', arguments: { product_id: 'legacy-stock-product', quantity: 3 } },
      }));
      expect(legacyStock.structuredContent).toMatchObject({ success: false });
      expect(JSON.stringify(legacyStock)).not.toContain('cart_url');
      const insufficientLegacyStock = getResultRecord(await postMcpJsonRpc(server.baseUrl, {
        id: 73, method: 'tools/call',
        params: { name: 'add_to_cart', arguments: { product_id: 'legacy-stock-product', quantity: 4 } },
      }));
      expect(insufficientLegacyStock.structuredContent).toMatchObject({ success: false });
      expect(JSON.stringify(insufficientLegacyStock)).not.toContain('cart_url');

      const conditionOffer = getResultRecord(await postMcpJsonRpc(server.baseUrl, {
        id: 71,
        method: 'tools/call',
        params: { name: 'add_to_cart', arguments: { product_id: 'condition-offer-product', quantity: 1 } },
      }));
      expect(conditionOffer.structuredContent).toMatchObject({
        success: false,
        requires_variant_selection: true,
        product_url: 'https://ogabassey.com/products/used-offer-phone',
      });
      expect(JSON.stringify(conditionOffer)).not.toContain('cart_url');

      const soldOutOffer = getResultRecord(await postMcpJsonRpc(server.baseUrl, {
        id: 74, method: 'tools/call',
        params: { name: 'add_to_cart', arguments: { product_id: 'condition-offer-sold-out-product', quantity: 1 } },
      }));
      expect(soldOutOffer.structuredContent).toMatchObject({ success: false });
      expect(JSON.stringify(soldOutOffer)).not.toContain('requires_variant_selection');

      const insufficientOfferQuantity = getResultRecord(await postMcpJsonRpc(server.baseUrl, {
        id: 75, method: 'tools/call',
        params: { name: 'add_to_cart', arguments: { product_id: 'condition-offer-product', quantity: 3 } },
      }));
      expect(insufficientOfferQuantity.structuredContent).toMatchObject({ success: false });
      expect(JSON.stringify(insufficientOfferQuantity)).not.toContain('requires_variant_selection');

      const stockedParentOffer = getResultRecord(await postMcpJsonRpc(server.baseUrl, {
        id: 76, method: 'tools/call',
        params: { name: 'add_to_cart', arguments: { product_id: 'condition-offer-parent-stock-product', quantity: 2 } },
      }));
      expect(stockedParentOffer.structuredContent).toMatchObject({ requires_variant_selection: true });

      const fractionalQuantity = getResultRecord(await postMcpJsonRpc(server.baseUrl, {
        id: 77, method: 'tools/call',
        params: { name: 'add_to_cart', arguments: { product_id: 'available-product', quantity: 1.5 } },
      }));
      expect(fractionalQuantity.isError).toBe(true);
      expect(JSON.stringify(fractionalQuantity)).not.toContain('cart_url');

      const insufficientVariantQuantity = getResultRecord(
        await postMcpJsonRpc(server.baseUrl, {
          id: 8,
          method: 'tools/call',
          params: {
            name: 'add_to_cart',
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
            name: 'add_to_cart',
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
});
