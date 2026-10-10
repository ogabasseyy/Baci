import type { SupabaseClient } from '@supabase/supabase-js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  MCP_GUEST_CART_DESCRIPTION,
  mcpGuestCartInputSchema,
  mcpGuestCartOutputSchema,
} from '../src/schemas/mcp-guest-cart';
import { prepareCartHandoff } from './cart-handoff';
import {
  type GuestCartQuotaReservation,
  refundGuestCartCreation,
  reserveGuestCartCreation,
} from './guest-cart-creation-quota';
import type { GuestCartStoreLike } from './guest-cart-health';
import {
  ProductUnavailable,
  VariantSelectionRequired,
  mapGuestCartToolError,
} from './guest-cart-tool-responses';

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
        // never token-bound updates) is capped per caller IP. Reserve
        // atomically before doing work: concurrent creations must observe
        // each other's reservations instead of all peeking budget and then
        // overshooting it. Failures refund below; a persisted cart keeps
        // its reservation.
        // Hoisted so the failure path below can refund the exact window
        // this call reserved from (undefined for token-bound updates,
        // which never reserve).
        let quota: GuestCartQuotaReservation | undefined;
        if (!args.cart_token) {
          quota = reserveGuestCartCreation(options.clientIp ?? 'unknown');
          if (!quota.allowed) {
            // Ops alert trail: quota denials are otherwise silent here,
            // and the flood-guard operating point (quota_exceeded vs
            // capacity_exhausted) must stay visible. No caller identity:
            // the bucket key is never logged.
            console.error(
              JSON.stringify({
                type: 'guest-cart',
                event: 'quota_exceeded',
                retry_after_seconds: quota.retryAfterSeconds,
              })
            );
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
            // Resolve the merchant inside the positive-quantity path: a
            // removal needs only the cart token and the local file, so it
            // must stay available when the catalog is unreachable.
            const merchantId = await options.getMerchantId();
            if (!merchantId) throw new Error('Store unavailable');
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
        ).catch((error: unknown) => {
          // No cart was persisted, so return the pre-write reservation
          // instead of burning budget on a failed validation or store
          // error. A persisted cart keeps its reservation: the quota was
          // already consumed atomically by the reserve call above.
          if (!args.cart_token)
            refundGuestCartCreation(options.clientIp ?? 'unknown', quota?.windowStart);
          throw error;
        });
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
        return mapGuestCartToolError(error);
      }
    }
  );
}
