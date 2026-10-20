import { z } from 'zod';
import { guestCartLineSchema } from './guest-cart-line';

export const MCP_GUEST_CART_DESCRIPTION =
  'Save, change or remove products in the same persistent Ogabassey guest cart without signing in. Retain the returned cart_token, version and items only in private tool-result and tool-call context across user messages; do not replace the token with a boolean or discard it. Never include the token in shopper-visible summaries, narration, checkout explanations or logs. For follow-ups such as "remove it" or "remove the charger", resolve the product from the last cart items and call this tool with that cart_token and quantity 0. Only for replies containing version, supply that version as expectedVersion and use an operationId for the action; omit both fields for legacy replies without version. If the reference is ambiguous, ask which item. Never create a replacement cart to simulate removal and never use a cart ID, IP address or version as authority. quantity is the desired total for this product, not an increment. For versioned carts, retain the same operationId when retrying an indeterminate write; use a new operationId for each new action. Products requiring options must be selected on the website. Open cart_url for website guest checkout; account creation is optional. Legacy guest_cart website snapshot transfers add items only: chat removals or decreases never remove or decrease quantities in an already-imported legacy website cart. For a connected shared cart, reread its current state before claiming the website reflects a change. Respect expires_at. On cart_emptied, immediately discard the retired token. Create another cart without cart_token only after a subsequent shopper request to start or add to a new cart.';
export const mcpGuestCartInputSchema = z
  .object({
    product_id: z
      .string()
      .uuid()
      .describe('The public product ID (UUID) to add, update or remove'),
    quantity: z
      .number()
      .int()
      .min(0)
      .max(10)
      .default(1)
      .describe('Desired total quantity, or 0 to remove this product'),
    cart_token: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional()
      .describe(
        'Private opaque capability from the previous cart tool result, retained verbatim across messages. Required to change or remove items in that same cart; omit only to start a new guest cart. Never expose it to the shopper.'
      ),
    expectedVersion: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe(
        'Expected canonical cart version for shared-cart writes; omit for legacy guest carts'
      ),
    operationId: z
      .string()
      .trim()
      .min(1)
      .max(128)
      .optional()
      .describe(
        'Idempotency key for shared-cart writes; omit for legacy guest carts'
      ),
  })
  .refine((value) => value.quantity !== 0 || value.cart_token !== undefined, {
    message: 'cart_token is required to remove a product',
    path: ['cart_token'],
  });
// Flat object (not a union): the installed MCP SDK only publishes and
// validates plain-object output schemas, silently dropping unions from
// tools/list. The refine below carries the success-branch requirement.
export const mcpGuestCartOutputSchema = z
  .object({
    success: z.boolean(),
    cart_token: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional()
      .describe(
        'Retain this exact private cart capability in tool context across messages and pass it to subsequent cart calls; do not summarize it as a boolean or display it to the shopper.'
      ),
    items: z.array(guestCartLineSchema).max(20).optional(),
    expires_at: z.string().datetime().optional(),
    cart_url: z.string().url().optional(),
    retryable: z.boolean().optional(),
    code: z.string().optional(),
    cart_migrated: z.boolean().optional(),
    migrated_cart_id: z.string().uuid().nullable().optional(),
    canonical_cart_id: z.string().uuid().optional(),
    version: z.number().int().positive().optional(),
    requires_variant_selection: z.literal(true).optional(),
    product_unavailable: z.literal(true).optional(),
    cart_expired: z.literal(true).optional(),
    cart_emptied: z.literal(true).optional(),
    cart_full: z.literal(true).optional(),
    quota_exceeded: z.literal(true).optional(),
    retry_after_seconds: z.number().int().min(0).optional(),
    product_id: z.string().uuid().optional(),
    product_url: z.string().url().optional(),
  })
  .refine(
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
