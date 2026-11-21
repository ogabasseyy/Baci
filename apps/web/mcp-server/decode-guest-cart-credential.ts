import { modelCartCredentialSchema } from '../src/schemas/mcp-guest-cart';

/** Represent the same server-minted 256-bit capability on the model tool. */
export function decodeGuestCartCredential(credential: string): string {
  return Buffer.from(modelCartCredentialSchema.parse(credential), 'base64url').toString('hex');
}
