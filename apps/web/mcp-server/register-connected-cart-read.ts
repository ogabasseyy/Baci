import type { McpServer } from '@modelcontextprotocol/server';
import {
  guestOAuthCartOutputSchema,
  guestOAuthReadCartInputSchema,
} from '../src/schemas/guest-oauth';
import type { GuestCartStoreLike } from './guest-cart-health';

/** Fresh handoffs avoid navigating with an expired, cached five-minute link. */
export function registerConnectedCartRead(
  server: McpServer,
  store: GuestCartStoreLike,
  authority: { resolveToken(): Promise<string> },
) {
  server.registerTool(
    'get_ogabassey_guest_cart',
    {
      title: 'Get Ogabassey Guest Cart',
      description:
        'Read this connection’s current guest cart and prepare a fresh website checkout link. No cart token is needed. Use this before reviewing the cart on the website or when previous cart details are missing. If the shopper says the link ended, expired, is invalid or does not work, call this tool once to refresh the link for the same connected cart. Return the new cart_url exactly as received; never reconstruct or edit it. Do not replay add/remove operations or create a replacement cart to recover a link. If the returned cart is empty, explain that there are no saved items to recover; never repopulate it from chat history. If refreshing fails or the new link still fails, explain that recovery did not succeed rather than repeatedly retrying or claiming the cart was recovered. This never places an order or starts payment.',
      inputSchema: guestOAuthReadCartInputSchema,
      outputSchema: guestOAuthCartOutputSchema,
      // Initial access can bootstrap an empty cart and persist a handoff receipt.
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
        idempotentHint: false,
      },
      _meta: {
        securitySchemes: [{ type: 'oauth2', scopes: ['cart:write'] }],
        'openai/widgetAccessible': true,
      },
    },
    async () => {
      try {
        const token = await authority.resolveToken();
        if (!store.readConnectionCart) throw new Error('Unavailable');
        const cart = await store.readConnectionCart(token);
        if (!cart.cart_url && cart.items.length) throw new Error('Unavailable');
        return {
          content: [{ type: 'text' as const, text: 'Your current guest cart is ready to review.' }],
          structuredContent: {
            success: true,
            connection_bound: true as const,
            items: cart.items,
            expires_at: cart.expires_at,
            cart_url: cart.cart_url ?? 'https://ogabassey.com/cart',
            canonical_cart_id: cart.canonical_cart_id,
            version: cart.version,
          },
        };
      } catch {
        return {
          isError: true,
          content: [
            { type: 'text' as const, text: 'Could not refresh your connected cart. Please retry.' },
          ],
          structuredContent: { success: false, connection_bound: true as const },
        };
      }
    },
  );
}
