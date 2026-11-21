import { z } from 'zod';
import { modelCartCredentialSchema } from './model-cart-credential';

export const mcpGuestCartReadInputSchema = z.object({
  cartCredential: modelCartCredentialSchema,
});
