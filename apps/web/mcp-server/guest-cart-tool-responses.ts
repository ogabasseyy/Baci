import {
  GuestCartBridgePendingError,
  GuestCartCanonicalError,
  GuestCartExpiredError,
  GuestCartFullError,
  GuestCartMigratedError,
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
  // A migrated legacy cart has a canonical shared-cart successor: the
  // typed outcome carries it so the client refreshes into the shared
  // cart instead of starting a second guest cart.
  if (error instanceof GuestCartCanonicalError)
    return {
      content: [
        {
          type: 'text' as const,
          text: error.retryable
            ? 'The cart changed or is temporarily unavailable. Retry with the returned cart_token and current version.'
            : 'This cart action is not authorized or valid. Reconnect to continue.',
        },
      ],
      structuredContent: {
        success: false,
        code: error.code,
        retryable: error.retryable,
        ...(error.retryable ? { cart_token: error.cartToken } : {}),
        ...(error.cartId ? { canonical_cart_id: error.cartId } : {}),
        ...(error.version ? { version: error.version } : {}),
      },
    };
  if (error instanceof GuestCartBridgePendingError)
    return {
      content: [
        {
          type: 'text' as const,
          text: 'Your guest cart is saved. Retry using the returned cart_token to finish connecting it.',
        },
      ],
      structuredContent: {
        success: false,
        cart_token: error.cartToken,
        retryable: true,
        code: 'refresh_required',
      },
    };
  if (error instanceof GuestCartMigratedError) {
    return {
      content: [
        {
          type: 'text' as const,
          text: error.cartId
            ? `This guest cart moved to the shared cart (${error.cartId}). Refresh the cart to continue with the shared cart.`
            : 'This guest cart moved to the shared cart. Refresh the cart to continue with the shared cart.',
        },
      ],
      structuredContent: {
        success: false,
        cart_migrated: true,
        migrated_cart_id: error.cartId,
      },
    };
  }
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
