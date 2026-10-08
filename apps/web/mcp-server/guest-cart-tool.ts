import type { SupabaseClient } from '@supabase/supabase-js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  MCP_GUEST_CART_DESCRIPTION,
  mcpGuestCartInputSchema,
  mcpGuestCartOutputSchema,
} from '../src/schemas/mcp-guest-cart';
import { prepareCartHandoff } from './cart-handoff';
import {
  consumeGuestCartCreation,
  peekGuestCartCreation,
} from './guest-cart-creation-quota';
import {
  GuestCartExpiredError,
  type GuestCartStoreLike,
} from './guest-cart-store';
import { GuestCartStorageUnavailableError } from './guest-cart-writer-lock-errors';

class VariantSelectionRequired extends Error {
  constructor(
    readonly productId: string,
    readonly productUrl: string
  ) {
    super('Variant selection required');
    this.name = 'VariantSelectionRequired';
  }
}

class ProductUnavailable extends Error {
  constructor(readonly productId: string) {
    super('Product unavailable');
    this.name = 'ProductUnavailable';
  }
}

export function registerGuestCartTool(
  server: McpServer,
  options: {
    store: GuestCartStoreLike;
    supabase: SupabaseClient;
    getMerchantId: () => Promise<string | null>;
    formatPrice: (price: number) => string;
    clientIp?: string;
  }
) {
  server.registerTool(
    'update_ogabassey_guest_cart',
    {
      outputSchema: mcpGuestCartOutputSchema,
      title: 'Update Ogabassey Guest Cart',
      description: MCP_GUEST_CART_DESCRIPTION,
      inputSchema: mcpGuestCartInputSchema.shape,
      annotations: {
        readOnlyHint: false,
        // Quantity 0 removes a line and a lowered absolute quantity shrinks
        // persisted state, so this tool is not additive-only.
        destructiveHint: true,
        openWorldHint: false,
        // Token-bound updates are idempotent (absolute quantities replace the
        // line), but a tokenless call mints a fresh cart every time, so a
        // lost-response retry without the token is not idempotent.
        idempotentHint: false,
      },
      _meta: {
        'openai/widgetAccessible': true,
        'openai/toolInvocation/invoking': 'Saving to your guest cart…',
        'openai/toolInvocation/invoked': 'Guest cart saved',
      },
    },
    async (args) => {
      try {
        // Registration passes only the input shape, which drops the
        // object-level refinement, so re-parse with the full schema
        // before quota or database work: cross-field violations fail
        // fast here instead of surfacing as generic store errors.
        const parsed = mcpGuestCartInputSchema.safeParse(args);
        if (!parsed.success) {
          return {
            isError: true,
            content: [
              {
                type: 'text' as const,
                text: `Invalid guest cart input: ${parsed.error.issues
                  .map((issue) => issue.message)
                  .join('; ')}`,
              },
            ],
            structuredContent: { success: false },
          };
        }
        // Tokenless calls mint a fresh cart file, so anonymous creation (but
        // never token-bound updates) is capped per caller IP. Peek first:
        // failed validations and store errors return below without
        // consuming quota; only a persisted cart is recorded.
        if (!args.cart_token) {
          const quota = peekGuestCartCreation(options.clientIp ?? 'unknown');
          if (!quota.allowed) {
            return {
              isError: true,
              content: [
                {
                  type: 'text' as const,
                  text: 'Too many guest carts were created from this address. Continue an existing cart with its cart token, or try again later.',
                },
              ],
              structuredContent: {
                success: false,
                quota_exceeded: true,
                retry_after_seconds: quota.retryAfterSeconds,
              },
            };
          }
        }
        const merchantId = await options.getMerchantId();
        if (!merchantId) throw new Error('Store unavailable');
        // UUID text is case-insensitive but the variants check compares
        // exact strings, so canonicalize before validation the way the
        // store does before persistence: an uppercase ID must select
        // options like its lowercase twin instead of missing every
        // variant and reporting the product unavailable.
        const productId = args.product_id.toLowerCase();
        const cart = await options.store.update(
          args.cart_token,
          { ...args, product_id: productId },
          async () => {
            // Only the changed line is validated: a stale survivor must not
            // freeze unrelated adds. Stale lines stay visible in the chat
            // cart and the website re-checks stock at transfer, so handoff
            // can only carry lines the catalog still honors.
            if (args.quantity === 0) return;
            const result = await prepareCartHandoff({
              supabase: options.supabase,
              merchantId,
              productId,
              quantity: args.quantity,
              formatPrice: options.formatPrice,
            });
            const handoff = result.structuredContent;
            if (handoff?.success !== true) {
              if (
                handoff?.requires_variant_selection === true &&
                typeof handoff?.product_url === 'string'
              ) {
                throw new VariantSelectionRequired(
                  productId,
                  handoff.product_url
                );
              }
              if (handoff?.product_unavailable === true) {
                throw new ProductUnavailable(productId);
              }
              throw new Error(
                'A product is unavailable or requires option selection'
              );
            }
          }
        );
        if (!args.cart_token) {
          // Record the persisted cart. A denial here means concurrent
          // creations filled the window mid-flight; the cart already
          // exists, so the overshoot stands and no error is returned.
          consumeGuestCartCreation(options.clientIp ?? 'unknown');
        }
        const url = new URL('https://ogabassey.com/cart');
        // An emptied cart transfers nothing, so advertise the bare cart
        // page instead of a guest_cart=[] link the website would reject.
        if (cart.items.length > 0)
          url.searchParams.set('guest_cart', JSON.stringify(cart.items));
        return {
          content: [
            {
              type: 'text' as const,
              text: `Saved to your Ogabassey guest cart. No sign-in required.\n\n[Review cart and checkout](${url})`,
            },
          ],
          structuredContent: {
            success: true,
            ...cart,
            cart_url: url.toString(),
          },
        };
      } catch (error) {
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
        // Cart storage is misconfigured, so the server registered this tool
        // degraded to keep catalog tools up: say the outage plainly instead
        // of sending the model chasing product availability.
        if (error instanceof GuestCartStorageUnavailableError) {
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
    }
  );
}
