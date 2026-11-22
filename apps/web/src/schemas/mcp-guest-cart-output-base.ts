import { z } from 'zod';
import { guestCartLineSchema } from './guest-cart-line';

export const mcpGuestCartOutputBase = z.object({
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
});
