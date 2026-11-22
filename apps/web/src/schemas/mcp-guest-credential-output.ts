import { mcpGuestCartOutputBase } from './mcp-guest-cart-output-base';
import { modelCartCredentialSchema } from './model-cart-credential';

export const mcpGuestCredentialOutputSchema = mcpGuestCartOutputBase
  .omit({ cart_token: true })
  .extend({ cartCredential: modelCartCredentialSchema.optional() })
  .refine(
    (value) => {
      if (!value.success) return true;
      if (!value.items || !value.expires_at || !value.cart_url) return false;
      if (value.cart_emptied) {
        return value.items.length === 0 && value.cartCredential === undefined;
      }
      return value.cartCredential !== undefined;
    },
    {
      message:
        'Successful guest-cart output must include cart details and the appropriate credential state',
    }
  );
