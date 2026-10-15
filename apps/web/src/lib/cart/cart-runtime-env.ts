import { createHash } from 'node:crypto';

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
 * one deployment never verifies in another. Explicit override first.
 * Preview deployments all share the generic VERCEL_ENV value, so the
 * deployment-unique VERCEL_URL binds the domain there; proofs from one
 * preview deployment never replay on another.
 */
export function getCartProofEnvironment(): string {
  assertServerRuntime('cart proof environment');
  const override = process.env.CART_PROOF_ENVIRONMENT?.trim();
  if (override) return override;
  const vercel = process.env.VERCEL_ENV?.trim();
  if (vercel === 'preview') {
    const deployment = process.env.VERCEL_URL?.trim();
    if (deployment) {
      const identity = `preview:${deployment}`;
      // Proof claims allow 64 characters. Keep existing short identities,
      // and bind long hostnames with a stable 256-bit digest.
      return identity.length <= 64
        ? identity
        : `preview:${createHash('sha256').update(deployment).digest('base64url')}`;
    }
  }
  if (vercel) return vercel;
  return process.env.NODE_ENV?.trim() || 'development';
}

/** Optional previous signing keys for bounded, server-only rotation windows.
 * Reading configuration does not provision or authorize a production change.
 */
export function getCartPreviousSessionSecrets(): string[] {
  assertServerRuntime('CART_SESSION_PREVIOUS_SECRETS');
  try {
    const value: unknown = JSON.parse(
      process.env.CART_SESSION_PREVIOUS_SECRETS ?? '[]'
    );
    if (
      !Array.isArray(value) ||
      value.length > 8 ||
      !value.every(
        (key): key is string =>
          typeof key === 'string' && key.trim().length >= 32
      )
    )
      return [];
    return value.map((key) => key.trim());
  } catch {
    return [];
  }
}
