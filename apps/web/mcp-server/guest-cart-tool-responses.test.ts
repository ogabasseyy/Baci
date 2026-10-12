import { afterEach, expect, it, vi } from 'vitest';
import {
  GuestCartExpiredError,
  GuestCartFullError,
  GuestCartStorageUnavailableError,
} from './guest-cart-errors';
import {
  ProductUnavailable,
  VariantSelectionRequired,
  mapGuestCartToolError,
} from './guest-cart-tool-responses';

afterEach(() => {
  vi.restoreAllMocks();
});

it('types an expired token as recoverable without a tool error', () => {
  expect(mapGuestCartToolError(new GuestCartExpiredError())).toEqual({
    content: [
      {
        type: 'text',
        text: 'This guest cart expired or is no longer available. Retry without the cart token to start a new cart.',
      },
    ],
    structuredContent: { success: false, cart_expired: true },
  });
});

it('types a full cart with the drop-a-line remedy', () => {
  expect(mapGuestCartToolError(new GuestCartFullError())).toEqual({
    content: [
      {
        type: 'text',
        text: 'This guest cart already holds 20 products. Remove a product with quantity 0, then add the new one.',
      },
    ],
    structuredContent: { success: false, cart_full: true },
  });
});

it('types option selection with the product URL', () => {
  const productId = '11111111-1111-4111-8111-111111111111';
  const productUrl = `https://ogabassey.com/products/${productId}`;
  expect(
    mapGuestCartToolError(new VariantSelectionRequired(productId, productUrl))
  ).toEqual({
    content: [
      {
        type: 'text',
        text: `Choose the available options for this product on Ogabassey before adding it to your guest cart.\n\n[Select product options](${productUrl})`,
      },
    ],
    structuredContent: {
      success: false,
      requires_variant_selection: true,
      product_id: productId,
      product_url: productUrl,
    },
  });
});

it('types a dead product so recovery can skip that survivor', () => {
  const productId = '11111111-1111-4111-8111-111111111111';
  expect(mapGuestCartToolError(new ProductUnavailable(productId))).toEqual({
    content: [
      {
        type: 'text',
        text: 'This product is no longer available, so the guest cart was left unchanged.',
      },
    ],
    structuredContent: {
      success: false,
      product_unavailable: true,
      product_id: productId,
    },
  });
});

it('degrades a storage outage with a token-free ops log', () => {
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  const result = mapGuestCartToolError(
    new GuestCartStorageUnavailableError(
      'connect ECONNREFUSED /var/lib/baci/guest-carts/deadbeef.json',
      'ECONNREFUSED'
    )
  );
  expect(result).toEqual({
    isError: true,
    content: [
      {
        type: 'text',
        text: 'Ogabassey guest carts are temporarily unavailable. Catalog search and product pages still work; try the guest cart again later.',
      },
    ],
    structuredContent: { success: false },
  });
  // The ops trail carries the errno only: messages may embed paths that
  // carry token filenames, and capability tokens never reach logs.
  expect(errorSpy).toHaveBeenCalledTimes(1);
  const logged = String(errorSpy.mock.calls[0][0]);
  expect(JSON.parse(logged)).toEqual({
    type: 'guest-cart',
    event: 'storage_unavailable',
    code: 'ECONNREFUSED',
  });
  expect(logged).not.toContain('deadbeef');
});

it('falls back to a generic tool error for unknown failures', () => {
  expect(mapGuestCartToolError(new Error('boom'))).toEqual({
    isError: true,
    content: [
      {
        type: 'text',
        text: 'Could not save this guest cart. Check product availability and options, or start a new cart if it has expired.',
      },
    ],
    structuredContent: { success: false },
  });
});
