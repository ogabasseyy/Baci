import { mcpGuestCartInputSchema } from '../src/schemas/mcp-guest-cart';
import { mcpGuestCredentialUpdateInputSchema } from '../src/schemas/mcp-guest-credential-update-input';
import { decodeGuestCartCredential } from './decode-guest-cart-credential';

export function parseGuestCredentialUpdateInput(input: unknown) {
  const parsed = mcpGuestCredentialUpdateInputSchema.safeParse(input);
  if (!parsed.success) return parsed;
  const { cartCredential, startFreshIfUnavailable: _, ...update } = parsed.data;
  // The internal schema also enforces exactly 64 lowercase hex digits.
  return mcpGuestCartInputSchema.safeParse({
    ...update,
    cart_token: cartCredential && decodeGuestCartCredential(cartCredential),
  });
}
