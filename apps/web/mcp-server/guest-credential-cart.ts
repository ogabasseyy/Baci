import type { McpServer } from '@modelcontextprotocol/server';
import {
  mcpGuestCredentialOutputSchema,
  mcpGuestCartReadInputSchema,
  modelCartCredentialSchema,
} from '../src/schemas/mcp-guest-cart';
import {
  GuestCartCanonicalError,
  GuestCartStorageUnavailableError,
} from './guest-cart-errors';
import type { GuestCartStoreLike } from './guest-cart-health';
import { mapGuestCartToolError } from './guest-cart-tool-responses';

export const GUEST_CREDENTIAL_UPDATE_DESCRIPTION =
  'Add, change or remove items in the same Ogabassey guest cart. The first add creates the cart automatically without sign-in; omit cartCredential only when starting a new cart. On later messages reuse the exact cartCredential from structuredContent and never display it. For "remove it" or "remove the charger", match the referenced item to a product_id from the last cart result and set quantity to zero. Ask which item if ambiguous. If cart details are missing, call get_ogabassey_guest_cart with the same credential. If the credential is missing or expired, explain that the existing cart could not be updated. Never guess a credential or create a replacement cart to simulate removal. Quantity is the desired total for that product. Send the returned version as expectedVersion and a new operationId for each distinct edit. Preserve operationId on retries when the result is unknown. Use cart_url exactly as returned to open the remaining items on the website; call get_ogabassey_guest_cart to refresh a link. Account creation at checkout is optional. This tool never places an order or starts payment.';

export function guestCredentialModeEnabled(
  canonicalEnabled: boolean,
  env: Readonly<Record<string, string | undefined>> = process.env
): boolean {
  if (env.BACI_MCP_GUEST_CREDENTIAL_ENABLED !== 'true') return false;
  if (
    !canonicalEnabled ||
    env.BACI_MCP_GUEST_OAUTH_ENABLED === 'true' ||
    ['true', '1'].includes(env.MCP_ENABLE_AGENTIC_CHECKOUT_TOOLS ?? '')
  ) {
    throw new Error(
      'Guest credential mode requires the canonical bridge and a cart-only MCP instance without guest OAuth'
    );
  }
  return true;
}

/** Preserve the exact broker URL. A legacy item snapshot cannot be imported safely. */
export function guestCredentialHandoffUrl(cart: {
  cart_token: string;
  items: readonly unknown[];
  version?: number;
  canonical_cart_id?: string;
  cart_url?: string;
}): string {
  const handoff = cart.cart_url;
  const url = handoff ? URL.parse(handoff) : null;
  const fragment = new URLSearchParams(url?.hash.slice(1));
  if (!cart.canonical_cart_id || !cart.version)
    throw new GuestCartStorageUnavailableError('Canonical cart unavailable');
  if (!cart.items.length) return 'https://ogabassey.com/cart';
  if (
    !handoff ||
    url?.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.pathname !== '/cart' ||
    url.search ||
    !fragment.get('handoff') ||
    !fragment.get('hid')
  ) {
    throw new GuestCartCanonicalError(
      'refresh_required',
      cart.cart_token,
      cart.canonical_cart_id,
      cart.version
    );
  }
  return handoff;
}

export function registerGuestCredentialRead(
  server: McpServer,
  store: GuestCartStoreLike
) {
  server.registerTool(
    'get_ogabassey_guest_cart',
    {
      title: 'Get Ogabassey Guest Cart',
      description:
        'Read the existing guest cart and return a fresh website checkout link for its remaining items. Reuse the exact private cartCredential from the last successful cart tool result in this chat. Use this when a cart link is invalid or has ended. Show the cart_url exactly as returned. Never repeat an add or removal to refresh a link. Do not expose the cart token. This tool never places an order or starts payment.',
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

/** Represent the same server-minted 256-bit capability on the model tool. */
export function decodeGuestCartCredential(credential: string): string {
  return Buffer.from(modelCartCredentialSchema.parse(credential), 'base64url').toString('hex');
}

export function guestCredentialReply<
  T extends { structuredContent: Record<string, unknown> },
>(reply: T) {
  const { cart_token, ...state } = reply.structuredContent;
  const credential =
    typeof cart_token === 'string' && /^[a-f0-9]{64}$/.test(cart_token)
      ? Buffer.from(cart_token, 'hex').toString('base64url')
      : undefined;
  return {
    ...reply,
    structuredContent: {
      ...state,
      ...(credential && state.cart_emptied !== true
        ? { cartCredential: credential }
        : {}),
    },
  };
}
