function assertServerRuntime(variable: string) {
  if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'test') {
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
