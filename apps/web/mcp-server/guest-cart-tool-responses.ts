import {
  GuestCartExpiredError,
  GuestCartFullError,
  GuestCartStorageUnavailableError,
} from './guest-cart-errors';

export class VariantSelectionRequired extends Error {
  constructor(
    readonly productId: string,
    readonly productUrl: string
  ) {
    super('Variant selection required');
    this.name = 'VariantSelectionRequired';
  }
}

export class ProductUnavailable extends Error {
  constructor(readonly productId: string) {
    super('Product unavailable');
    this.name = 'ProductUnavailable';
  }
}

/**
 * Maps a guest-cart failure to its typed tool response: recoverable
 * outcomes (expired, full, option selection, dead product) stay
 * instructive instead of generic, and storage outages degrade plainly.
 * Split from the tool registration to hold the 300-line file budget.
 */
export function mapGuestCartToolError(error: unknown) {
  // An expired, evicted, or unknown token is recoverable: the typed
  // flag tells the widget to retry once without the stale token.
  if (error instanceof GuestCartExpiredError) {
    return {
      content: [
        {
          type: 'text' as const,
          text: 'This guest cart expired or is no longer available. Retry without the cart token to start a new cart.',
        },
      ],
      structuredContent: { success: false, cart_expired: true },
    };
  }
  // A full cart is recoverable by dropping a line, so it is typed
  // (not a tool error): the model can tell the shopper exactly that
  // instead of reporting a transient failure.
  if (error instanceof GuestCartFullError) {
    return {
      content: [
        {
          type: 'text' as const,
          text: 'This guest cart already holds 20 products. Remove a product with quantity 0, then add the new one.',
        },
      ],
      structuredContent: { success: false, cart_full: true },
    };
  }
  if (error instanceof VariantSelectionRequired) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Choose the available options for this product on Ogabassey before adding it to your guest cart.\n\n[Select product options](${error.productUrl})`,
        },
      ],
      structuredContent: {
        success: false,
        requires_variant_selection: true,
        product_id: error.productId,
        product_url: error.productUrl,
      },
    };
  }
  // A dead product is typed (not a tool error) so expired-cart
  // recovery can skip that survivor instead of aborting the whole
  // replay; transient failures stay generic and abort instead.
  if (error instanceof ProductUnavailable) {
    return {
      content: [
        {
          type: 'text' as const,
          text: 'This product is no longer available, so the guest cart was left unchanged.',
        },
      ],
      structuredContent: {
        success: false,
        product_unavailable: true,
        product_id: error.productId,
      },
    };
  }
  // Cart storage fails at runtime (outage, capacity gate, expired
  // capability): degrade this call to keep catalog tools up, and say
  // the outage plainly instead of sending the model chasing product
  // availability. Startup stays fail-closed on a bad token — a secret
  // bug must block the deploy — so only runtime calls degrade here.
  if (error instanceof GuestCartStorageUnavailableError) {
    // Storage outages are otherwise silent at the call site: log the
    // token-free errno for the ops alert trail (messages embed file
    // paths that may carry token filenames).
    console.error(
      JSON.stringify({
        type: 'guest-cart',
        event: 'storage_unavailable',
        code: error.code ?? 'unknown',
      })
    );
    return {
      isError: true,
      content: [
        {
          type: 'text' as const,
          text: 'Ogabassey guest carts are temporarily unavailable. Catalog search and product pages still work; try the guest cart again later.',
        },
      ],
      structuredContent: { success: false },
    };
  }
  return {
    isError: true,
    content: [
      {
        type: 'text' as const,
        text: 'Could not save this guest cart. Check product availability and options, or start a new cart if it has expired.',
      },
    ],
    structuredContent: { success: false },
  };
}
