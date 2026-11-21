import { modelCartCredentialSchema } from '../src/schemas/model-cart-credential';

/** Represent the same server-minted 256-bit capability on the model tool. */
export function decodeGuestCartCredential(credential: string): string {
  return Buffer.from(modelCartCredentialSchema.parse(credential), 'base64url').toString('hex');
}
