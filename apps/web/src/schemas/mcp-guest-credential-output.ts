import { mcpGuestCartOutputBase } from './mcp-guest-cart-output-base';
import { modelCartCredentialSchema } from './model-cart-credential';

export const mcpGuestCredentialOutputSchema = mcpGuestCartOutputBase
  .omit({ cart_token: true })
  .extend({ cartCredential: modelCartCredentialSchema.optional() })
  .refine(
    (value) =>
      value.success === false ||
      (value.cartCredential !== undefined &&
        value.items !== undefined &&
        value.expires_at !== undefined &&
        value.cart_url !== undefined),
    {
      message:
        'Successful guest-cart output must include its credential and handoff fields',
    }
  );
