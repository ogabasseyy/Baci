import { z } from 'zod';

export const guestCartLineSchema = z.object({
  product_id: z.string().uuid(),
  quantity: z.number().int().min(1).max(10),
});
export const guestCartHandoffSchema = z
  .array(guestCartLineSchema)
  .min(1)
  .max(20)
  .refine(
    (items) =>
      new Set(items.map((item) => item.product_id.toLowerCase())).size ===
      items.length
  );

export const MCP_GUEST_CART_DESCRIPTION =
  'Save a simple product in a persistent Ogabassey guest cart without signing in. Supply the cart_token returned previously to continue the same cart. Use quantity 0 to remove a product. quantity is the desired total for this product, not an increment, so retries with the same cart token are safe. Products requiring options must be selected on the website. Open cart_url to transfer all items to the website for guest checkout; account creation is optional there. Guest carts expire seven days after the last update.';
export const mcpGuestCartInputSchema = z.object({
  product_id: z
    .string()
    .uuid()
    .describe('The public product ID to add, update or remove'),
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
      'Opaque capability returned by the previous cart call; omit only to start a new guest cart'
    ),
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
      .optional(),
    items: z.array(guestCartLineSchema).max(20).optional(),
    expires_at: z.string().datetime().optional(),
    cart_url: z.string().url().optional(),
    requires_variant_selection: z.literal(true).optional(),
    cart_expired: z.literal(true).optional(),
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
