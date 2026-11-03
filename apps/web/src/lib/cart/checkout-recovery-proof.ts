import { z } from 'zod';
import { getCartProofEnvironment } from './cart-runtime-env';
import { readCookieFromRequest } from './principal';
import { verifyCartSessionProof } from './session-proof';

/** Recovery authority is deliberately distinct from normal cart authority. */
export function checkoutRecoveryAudience(
  sessionId: string,
  userId: string | null
) {
  return `baci:checkout-recovery:${sessionId}:${userId ?? 'guest'}`;
}

export function checkoutRecoveryCookieName(merchantId: string) {
  return `baci-checkout-recovery-${merchantId.trim().toLowerCase()}`;
}

/** Presented recovery material cannot be silently downgraded to legacy checkout. */
export function requestPresentsCheckoutRecoveryProof(
  request: Request,
  merchantId: string
): boolean {
  return (
    readCookieFromRequest(
      request,
      checkoutRecoveryCookieName(merchantId)
    )?.startsWith('cp1.') === true
  );
}

export function verifyCheckoutRecoveryProof(
  request: Request,
  input: {
    merchantId: string;
    cartId: string;
    sessionId: string;
    userId: string | null;
  }
): { ok: true; principalId: string } | { ok: false } {
  if (
    !z.uuid().safeParse(input.sessionId).success ||
    (input.userId !== null && !z.uuid().safeParse(input.userId).success)
  ) {
    return { ok: false };
  }
  const encoded = readCookieFromRequest(
    request,
    checkoutRecoveryCookieName(input.merchantId)
  );
  if (!encoded) return { ok: false };
  try {
    const proof = verifyCartSessionProof(decodeURIComponent(encoded), {
      environment: getCartProofEnvironment(),
      audience: checkoutRecoveryAudience(input.sessionId, input.userId),
    });
    if (
      !proof.ok ||
      proof.session.merchantId !== input.merchantId ||
      proof.session.cartId !== input.cartId ||
      !proof.session.principalId
    ) {
      return { ok: false };
    }
    return { ok: true, principalId: proof.session.principalId };
  } catch {
    return { ok: false };
  }
}
