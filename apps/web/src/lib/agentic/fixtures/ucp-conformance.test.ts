// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildUcpCatalogProductsResponse,
  mapStorefrontProductToUcpCatalogProduct,
  UCP_CATALOG_LOOKUP_CAPABILITY,
  UCP_CATALOG_SEARCH_CAPABILITY,
} from '@/lib/agentic/ucp-catalog-adapters';
import { buildUcpOrderResponse } from '@/lib/agentic/ucp-response-adapters';
import { stubAgenticEnv } from '../test-support/stub-agentic-env';
import {
  buildProfile,
  cartResponse,
  LINE_MINOR,
  MAJOR_PRICE,
  type ManifestMerchant,
  MERCHANT,
  orderBody,
  searchResponse,
  UNIT_MINOR,
} from './ucp-conformance-inputs';
import { UCP_SCHEMAS, validateUcpDocument } from './ucp-schema-validator';

describe('Baci UCP responses against the vendored 2026-04-08 schemas', () => {
  beforeEach(() => {
    vi.resetModules();
    stubAgenticEnv();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('business profile (/.well-known/ucp)', () => {
    it('validates against the discovery profile schema', async () => {
      const profile = await buildProfile();

      expect(validateUcpDocument(UCP_SCHEMAS.businessProfile, profile)).toEqual(
        { errors: [], valid: true }
      );
    });

    // Roadmap Task 3 (plan 3) adds the schema URL to the catalog and cart
    // declarations; this test then starts failing and `.fails` must go.
    it.fails('F7: every dev.ucp.shopping capability declares schema', async () => {
      const profile = await buildProfile();
      const shopping = Object.entries(profile.ucp.capabilities).filter(
        ([name]) => name.startsWith('dev.ucp.shopping.')
      );

      expect(shopping.map(([name]) => name).sort()).toEqual([
        'dev.ucp.shopping.cart',
        'dev.ucp.shopping.catalog.lookup',
        'dev.ucp.shopping.catalog.search',
        'dev.ucp.shopping.checkout',
        'dev.ucp.shopping.order',
      ]);
      const withoutSchema = shopping
        .filter(([, declarations]) =>
          declarations.some(
            (declaration) =>
              !validateUcpDocument(UCP_SCHEMAS.platformCapability, declaration)
                .valid
          )
        )
        .map(([name]) => name);

      expect(withoutSchema).toEqual([]);
    });

    // Roadmap Task 3 (plan 3) withholds cart when shared_cart_enabled is off.
    it.fails('F34: the cart capability follows shared_cart_enabled', async () => {
      const profile = await buildProfile({
        ...MERCHANT,
        shared_cart_enabled: false,
      } as ManifestMerchant);

      expect(profile.ucp.capabilities['dev.ucp.shopping.cart']).toBeUndefined();
    });
  });

  describe('catalog search and lookup', () => {
    it('emits a structurally valid search response', () => {
      const { response } = searchResponse();

      expect(
        validateUcpDocument(UCP_SCHEMAS.catalogSearchResponse, response)
      ).toEqual({ errors: [], valid: true });
    });

    it('emits a structurally valid lookup response', () => {
      const { product } = searchResponse();
      const response = buildUcpCatalogProductsResponse({
        capability: UCP_CATALOG_LOOKUP_CAPABILITY,
        products: [product],
      });

      expect(
        validateUcpDocument(UCP_SCHEMAS.catalogLookupResponse, response)
      ).toEqual({ errors: [], valid: true });
    });

    // Roadmap Task 4 (plan 4). The row mapper rounds N39.98 to 40, which the
    // schema accepts as an integer, so only the value reveals the unit bug.
    it.fails('F1: a N39.98 row is priced 3998 minor units', () => {
      const { product } = searchResponse();

      expect(product.price_range.min.amount).toBe(UNIT_MINOR);
      expect(product.variants[0].price.amount).toBe(UNIT_MINOR);
    });

    // Roadmap Task 4 (plan 4). The unrounded mapper emits 39.98 as the amount,
    // which the schema rejects because amounts are integers.
    it.fails('F1: a decimal major-unit price is a valid minor-unit amount', () => {
      const product = mapStorefrontProductToUcpCatalogProduct({
        currency: 'NGN',
        id: 'product-1',
        in_stock: true,
        name: 'Kobo phone',
        price: MAJOR_PRICE,
        product_url: 'https://ogabassey.com/ogabassey/products/kobo-phone',
      });
      const response = buildUcpCatalogProductsResponse({
        capability: UCP_CATALOG_SEARCH_CAPABILITY,
        products: [product],
      });

      expect(
        validateUcpDocument(UCP_SCHEMAS.catalogSearchResponse, response).errors
      ).toEqual([]);
    });
  });

  describe('cart', () => {
    // Roadmap Task 4 (plan 4) adds item.price to every cart line.
    it.fails('F3: every cart line item carries item.price', () => {
      expect(
        validateUcpDocument(UCP_SCHEMAS.cart, cartResponse()).errors
      ).toEqual([]);
    });

    it('is otherwise valid once item.price is present', () => {
      const cart = cartResponse();
      const withPrice = {
        ...cart,
        line_items: cart.line_items.map((line) => ({
          ...line,
          item: { ...line.item, price: UNIT_MINOR },
        })),
      };

      expect(validateUcpDocument(UCP_SCHEMAS.cart, withPrice)).toEqual({
        errors: [],
        valid: true,
      });
    });
  });

  describe('order', () => {
    it('validates a delivered order', () => {
      const order = buildUcpOrderResponse(orderBody('delivered'));

      expect(validateUcpDocument(UCP_SCHEMAS.order, order)).toEqual({
        errors: [],
        valid: true,
      });
    });

    // Roadmap Task 4 (plan 4). The adapter rounds N79.96 to 80 without
    // multiplying by 100; the schema accepts any integer, so only the value
    // shows the unit bug.
    it.fails('F33: order totals and unit prices are minor units', () => {
      const order = buildUcpOrderResponse(orderBody('delivered')) as {
        line_items: Array<{ item: { price: number } }>;
        totals: Array<{ amount: number; type: string }>;
      };

      expect(order.line_items[0].item.price).toBe(UNIT_MINOR);
      expect(order.totals.find((t) => t.type === 'total')?.amount).toBe(
        LINE_MINOR
      );
    });

    // Proposed finding F42, roadmap Task 4 (plan 4). Orders start at the
    // default `pending` shipping status, and any status yields a fulfillment
    // event; with nothing shipped yet the event is for quantity 0, which the
    // schema rejects (quantity >= 1).
    it.fails('F42: a pending order has no zero-quantity fulfillment event', () => {
      const order = buildUcpOrderResponse(orderBody('pending'));

      expect(validateUcpDocument(UCP_SCHEMAS.order, order).errors).toEqual([]);
    });
  });
});
