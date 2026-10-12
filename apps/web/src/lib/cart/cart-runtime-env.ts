function assertServerRuntime(variable: string) {
  if (
    typeof window !== 'undefined' &&
    process.env.NODE_ENV !== 'test' &&
    !process.env.VITEST
  ) {
    throw new Error(`${variable} cannot be accessed on the client`);
  }
}

/**
 * Server-only HMAC secret for cart session proofs.
 *
 * Production provisioning of CART_SESSION_SECRET requires the repository's
 * explicit environment approval before activation; until then this returns
 * undefined and proof issuance fails closed.
 */
export function getCartSessionSecret(): string | undefined {
  assertServerRuntime('CART_SESSION_SECRET');
  const secret = process.env.CART_SESSION_SECRET?.trim();
  return secret || undefined;
}

/**
 * Environment discriminator bound into cart proofs so a proof minted in
 * one deployment never verifies in another. Explicit override first,
 * then the platform environment, then a development default.
 */
export function getCartProofEnvironment(): string {
  assertServerRuntime('cart proof environment');
  const override = process.env.CART_PROOF_ENVIRONMENT?.trim();
  if (override) return override;
  const vercel = process.env.VERCEL_ENV?.trim();
  if (vercel) return vercel;
  return process.env.NODE_ENV?.trim() || 'development';
}
