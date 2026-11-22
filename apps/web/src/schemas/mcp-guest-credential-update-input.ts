import { mcpGuestCartInputBase } from './mcp-guest-cart-input-base';
import { modelCartCredentialSchema } from './model-cart-credential';

export const mcpGuestCredentialUpdateInputSchema = mcpGuestCartInputBase
  .omit({ cart_token: true })
  .extend({ cartCredential: modelCartCredentialSchema.optional() })
  .strict()
  .refine(
    (value) => value.quantity !== 0 || value.cartCredential !== undefined,
    {
      message: 'cartCredential is required to remove a product',
      path: ['cartCredential'],
    }
  );
