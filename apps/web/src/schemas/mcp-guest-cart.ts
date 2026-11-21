import { mcpGuestCartInputBase } from './mcp-guest-cart-input-base';
import { mcpGuestCartOutputBase } from './mcp-guest-cart-output-base';

export const MCP_GUEST_CART_DESCRIPTION =
  'Save, change or remove products in the same persistent Ogabassey guest cart without signing in. Retain the returned cart_token, version and items only in private tool-result and tool-call context across user messages; do not replace the token with a boolean or discard it. Never include the token in shopper-visible summaries, narration, checkout explanations or logs. For follow-ups such as "remove it" or "remove the charger", resolve the product from the last cart items and call this tool with that cart_token and quantity 0. Only for replies containing version, supply that version as expectedVersion and use an operationId for the action; omit both fields for legacy replies without version. If the reference is ambiguous, ask which item. Never create a replacement cart to simulate removal and never use a cart ID, IP address or version as authority. quantity is the desired total for this product, not an increment. For versioned carts, retain the same operationId when retrying an indeterminate write; use a new operationId for each new action. Products requiring options must be selected on the website. Open cart_url for website guest checkout; account creation is optional. Legacy guest_cart website snapshot transfers add items only: chat removals or decreases never remove or decrease quantities in an already-imported legacy website cart. For a connected shared cart, reread its current state before claiming the website reflects a change. Respect expires_at. On cart_emptied, immediately discard the retired token. Create another cart without cart_token only after a subsequent shopper request to start or add to a new cart.';

export const mcpGuestCartInputSchema = mcpGuestCartInputBase.refine(
  (value) => value.quantity !== 0 || value.cart_token !== undefined,
  {
    message: 'cart_token is required to remove a product',
    path: ['cart_token'],
  }
);

export const mcpGuestCartOutputSchema = mcpGuestCartOutputBase.refine(
  (value) =>
    value.success === false ||
    (value.cart_token !== undefined &&
      value.items !== undefined &&
      value.expires_at !== undefined &&
      value.cart_url !== undefined),
  {
    message:
      'Successful guest-cart output must include the cart handoff fields',
  }
);
