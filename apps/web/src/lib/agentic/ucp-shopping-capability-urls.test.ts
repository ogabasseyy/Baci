import { describe, expect, it } from 'vitest';
import { UCP_SHOPPING_URLS } from './ucp-shopping-capability-urls';

describe('UCP_SHOPPING_URLS', () => {
  it('uses the 2026-04-08 cart and catalog spec and schema URLs', () => {
    expect(UCP_SHOPPING_URLS.cart).toEqual({
      schema: 'https://ucp.dev/2026-04-08/schemas/shopping/cart.json',
      spec: 'https://ucp.dev/2026-04-08/specification/cart',
    });
    expect(UCP_SHOPPING_URLS.catalogSearch).toEqual({
      schema: 'https://ucp.dev/2026-04-08/schemas/shopping/catalog_search.json',
      spec: 'https://ucp.dev/2026-04-08/specification/catalog/search',
    });
    expect(UCP_SHOPPING_URLS.catalogLookup).toEqual({
      schema: 'https://ucp.dev/2026-04-08/schemas/shopping/catalog_lookup.json',
      spec: 'https://ucp.dev/2026-04-08/specification/catalog/lookup',
    });
  });

  it('keeps the checkout, order and service URLs the profile already used', () => {
    expect(UCP_SHOPPING_URLS.checkout).toEqual({
      schema: 'https://ucp.dev/2026-04-08/schemas/shopping/checkout.json',
      spec: 'https://ucp.dev/2026-04-08/specification/checkout',
    });
    expect(UCP_SHOPPING_URLS.order).toEqual({
      schema: 'https://ucp.dev/2026-04-08/schemas/shopping/order.json',
      spec: 'https://ucp.dev/2026-04-08/specification/order',
    });
    expect(UCP_SHOPPING_URLS.service).toEqual({
      schema: 'https://ucp.dev/2026-04-08/services/shopping/rest.openapi.json',
      spec: 'https://ucp.dev/2026-04-08/specification/overview',
    });
  });
});
