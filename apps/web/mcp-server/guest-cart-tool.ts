import type { SupabaseClient } from '@supabase/supabase-js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  MCP_GUEST_CART_DESCRIPTION,
  mcpGuestCartInputSchema,
  mcpGuestCartOutputSchema,
} from '../src/schemas/mcp-guest-cart';
import { prepareCartHandoff } from './cart-handoff';
import { GuestCartStore } from './guest-cart-store';

class VariantSelectionRequired extends Error {
  constructor(
    readonly productId: string,
    readonly productUrl: string
  ) {
    super('Variant selection required');
    this.name = 'VariantSelectionRequired';
  }
}

export function registerGuestCartTool(
  server: McpServer,
  options: {
    store: GuestCartStore;
    supabase: SupabaseClient;
    getMerchantId: () => Promise<string | null>;
    formatPrice: (price: number) => string;
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
        const merchantId = await options.getMerchantId();
        if (!merchantId) throw new Error('Store unavailable');
        const cart = await options.store.update(
          args.cart_token,
          args,
          async (items) => {
            // Full-cart validation is intentional: the handoff must never
            // carry stale lines. A stale survivor therefore blocks unrelated
            // adds until removed, and removals skip validation as the escape
            // hatch so a frozen cart can always be drained. The website
            // re-checks stock at transfer, so this cannot oversell.
            if (args.quantity === 0) return;
            for (const item of items) {
              const result = await prepareCartHandoff({
                supabase: options.supabase,
                merchantId,
                productId: item.product_id,
                quantity: item.quantity,
                formatPrice: options.formatPrice,
              });
              const handoff = result.structuredContent;
              if (handoff?.success !== true) {
                if (
                  handoff?.requires_variant_selection === true &&
                  typeof handoff?.product_url === 'string'
                ) {
                  throw new VariantSelectionRequired(
                    item.product_id,
                    handoff.product_url
                  );
                }
                throw new Error(
                  'A product is unavailable or requires option selection'
                );
              }
            }
          }
        );
        const url = new URL('https://ogabassey.com/cart');
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
