import type { SupabaseClient } from '@supabase/supabase-js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { mcpToolOutputSchemas } from '../src/schemas/mcp-tool-output';
import { prepareCartHandoff } from './cart-handoff';

// Shared cart-link registration, extracted from server.ts (which is far over
// the 300-line module budget): the input schema, the handoff handler, and
// the dual registration of the renamed tool plus its deprecated alias.
export function registerCartLinkTools(
  server: McpServer,
  options: {
    supabase: SupabaseClient;
    getMerchantId: () => Promise<string | null>;
    formatPrice: (price: number) => string;
  }
): void {
  // Tool: Add to Cart (Widget-accessible)
  // This tool can be called from the widget iframe using window.openai.callTool
  const cartLinkInputSchema = {
    product_id: z
      .string()
      .min(1)
      .max(80)
      .describe('The product ID to add to cart'),
    quantity: z
      .number()
      .int()
      .min(1)
      .max(10)
      .optional()
      .default(1)
      .describe('Quantity to add'),
  };
  const prepareCartLink = async (args: {
    product_id: string;
    quantity?: number;
  }) => {
    try {
      const merchantId = await options.getMerchantId();
      if (!merchantId) {
        return {
          content: [{ type: 'text' as const, text: '❌ Unable to access store.' }],
          structuredContent: { success: false, message: 'Store temporarily unavailable.' },
        };
      }

      return prepareCartHandoff({
        supabase: options.supabase,
        merchantId,
        productId: args.product_id,
        quantity: args.quantity ?? 1,
        formatPrice: options.formatPrice,
      });
    } catch (error) {
      console.error('Add to cart error:', error);
      return {
        content: [{ type: 'text' as const, text: '❌ Unable to add item to cart.' }],
        structuredContent: { success: false, message: 'Unable to prepare cart link.' },
      };
    }
  };
  const cartLinkToolConfig = {
    outputSchema: mcpToolOutputSchemas.prepare_storefront_cart_link,
    title: 'Prepare Ogabassey Cart Link',

    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    description:
      'Help the shopper add a public product to their Ogabassey cart. Simple products return a cart URL that adds the item when opened; products with options link to their product page for selection. This tool does not save an item inside ChatGPT or start checkout.',
    inputSchema: cartLinkInputSchema,
    _meta: {
      'openai/widgetAccessible': true, // Enable widget-initiated calls
      'openai/toolInvocation/invoking': 'Finding your cart on Ogabassey...',
      'openai/toolInvocation/invoked': 'Ready to add on Ogabassey',
    },
  };
  server.registerTool(
    'prepare_storefront_cart_link',
    cartLinkToolConfig,
    prepareCartLink
  );
  // Temporary compatibility alias for the pre-rename tool name: callers with
  // a cached tools/list entry or a hardcoded name keep working after upgrade.
  server.registerTool(
    'add_to_cart',
    {
      ...cartLinkToolConfig,
      title: 'Add to Cart (Deprecated Alias)',
      description: `Deprecated alias of prepare_storefront_cart_link. ${cartLinkToolConfig.description}`,
    },
    prepareCartLink
  );
}
