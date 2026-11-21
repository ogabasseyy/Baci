import { mcpGuestCartInputSchema } from '../src/schemas/mcp-guest-cart';
import { mcpGuestCredentialUpdateInputSchema } from '../src/schemas/mcp-guest-credential-update-input';

export function parseGuestCredentialUpdateInput(input: unknown) {
  const parsed = mcpGuestCredentialUpdateInputSchema.safeParse(input);
  if (!parsed.success) return parsed;
  const { cartCredential, ...update } = parsed.data;
  return mcpGuestCartInputSchema.safeParse({
    ...update,
    cart_token: cartCredential && Buffer.from(cartCredential, 'base64url').toString('hex'),
  });
}
