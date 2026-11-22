import { z } from 'zod';
import { mcpGuestCartInputBase } from './mcp-guest-cart-input-base';
import { modelCartCredentialSchema } from './model-cart-credential';

export const mcpGuestCredentialUpdateInputSchema = mcpGuestCartInputBase
  .omit({ cart_token: true })
  .extend({
    cartCredential: modelCartCredentialSchema.optional(),
    startFreshIfUnavailable: z
      .literal(true)
      .optional()
      .describe(
        'Use only for a new, explicit add when the shopper already had a cart. If that cart is missing or definitively expired, create a fresh cart containing only this addition. Never use for removal, quantity edits, or retries of an uncertain write.'
      ),
  })
  .strict()
  .refine(
    (value) => value.quantity !== 0 || value.startFreshIfUnavailable !== true,
    {
      message: 'Cannot start a fresh guest cart to remove a product',
      path: ['startFreshIfUnavailable'],
    }
  );
