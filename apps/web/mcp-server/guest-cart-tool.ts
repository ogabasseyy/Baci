import type { SupabaseClient } from '@supabase/supabase-js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  MCP_GUEST_CART_DESCRIPTION,
  mcpGuestCartInputSchema,
  mcpGuestCartOutputSchema,
} from '../src/schemas/mcp-guest-cart';
import { prepareCartHandoff } from './cart-handoff';
import { GuestCartStore } from './guest-cart-store';

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
      outputSchema: mcpGuestCartOutputSchema.shape,
      title: 'Update Ogabassey Guest Cart',
      description: MCP_GUEST_CART_DESCRIPTION,
      inputSchema: mcpGuestCartInputSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
        // Absolute quantities replace the line instead of incrementing, so a
        // lost-response retry with the same cart token has no cumulative effect.
        idempotentHint: true,
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
            if (args.quantity === 0) return;
            for (const item of items) {
              const result = await prepareCartHandoff({
                supabase: options.supabase,
                merchantId,
                productId: item.product_id,
                quantity: item.quantity,
                formatPrice: options.formatPrice,
              });
              if (result.structuredContent?.success !== true)
                throw new Error(
                  'A product is unavailable or requires option selection'
                );
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
      } catch {
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
