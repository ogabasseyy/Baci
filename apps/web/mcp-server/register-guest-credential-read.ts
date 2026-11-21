import type { McpServer } from '@modelcontextprotocol/server';
import {
  mcpGuestCredentialOutputSchema,
  mcpGuestCartReadInputSchema,
} from '../src/schemas/mcp-guest-cart';
import { decodeGuestCartCredential } from './decode-guest-cart-credential';
import { GuestCartStorageUnavailableError } from './guest-cart-errors';
import type { GuestCartStoreLike } from './guest-cart-health';
import { mapGuestCartToolError } from './guest-cart-tool-responses';
import { guestCredentialDescriptions } from './guest-credential-descriptions';
import { guestCredentialHandoffUrl } from './guest-credential-handoff-url';
import { guestCredentialReply } from './guest-credential-reply';

export function registerGuestCredentialRead(
  server: McpServer,
  store: GuestCartStoreLike
) {
  server.registerTool(
    'get_ogabassey_guest_cart',
    {
      title: 'Get Ogabassey Guest Cart',
      description:
        guestCredentialDescriptions.read,
      inputSchema: mcpGuestCartReadInputSchema,
      outputSchema: mcpGuestCredentialOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
      _meta: {
        securitySchemes: [{ type: 'noauth' }],
        ui: { visibility: ['model'] },
      },
    },
    async ({ cartCredential }) => {
      try {
        if (!store.readConnectionCart)
          throw new GuestCartStorageUnavailableError(
            'Canonical cart unavailable'
          );
        const cart = await store.readConnectionCart(
          decodeGuestCartCredential(cartCredential)
        );
        const cartUrl = guestCredentialHandoffUrl(cart);
        return guestCredentialReply({
          content: [
            {
              type: 'text' as const,
              text: cart.items.length
                ? `[Review cart and checkout](${cartUrl})`
                : 'Your Ogabassey guest cart is empty.',
            },
          ],
          structuredContent: { success: true, ...cart, cart_url: cartUrl },
        });
      } catch (error) {
        return guestCredentialReply(mapGuestCartToolError(error));
      }
    }
  );
}
