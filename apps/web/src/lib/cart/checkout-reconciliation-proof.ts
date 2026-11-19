import type { VerifiedCartSession } from '@baci/shared/cart';
import { z } from 'zod';
import { getCartProofEnvironment } from './cart-runtime-env';
import { checkoutRecoveryAudience } from './checkout-recovery-proof';
import { readCookieFromRequest } from './principal';
import { verifyCartSessionProofForCheckoutReconciliation } from './session-proof';

const authorityBrand: unique symbol = Symbol(
  'checkout-reconciliation-authority'
);

export type CheckoutReconciliationAuthority = {
  readonly [authorityBrand]: true;
  readonly session: VerifiedCartSession;
  readonly sessionId: string;
  readonly userId: string | null;
};

export function checkoutReconciliationCookieName(merchantId: string): string {
  return `baci-checkout-reconcile-${merchantId.trim().toLowerCase()}`;
}

/** Expired recovery material is usable only by the reconciliation capability. */
export function resolveCheckoutReconciliationAuthority(
  request: Request,
  input: {
    merchantId: string;
    cartId: string;
    sessionId: string;
    userId: string | null;
  }
): { ok: true; authority: CheckoutReconciliationAuthority } | { ok: false } {
  if (
    !z.uuid().safeParse(input.sessionId).success ||
    (input.userId !== null && !z.uuid().safeParse(input.userId).success)
  )
    return { ok: false };
  const cookie = readCookieFromRequest(
    request,
    checkoutReconciliationCookieName(input.merchantId)
  );
  if (!cookie) return { ok: false };
  try {
    const proof = verifyCartSessionProofForCheckoutReconciliation(
      decodeURIComponent(cookie),
      {
        environment: getCartProofEnvironment(),
        audience: checkoutRecoveryAudience(input.sessionId, input.userId),
      }
    );
    if (
      !proof.ok ||
      proof.session.merchantId !== input.merchantId ||
      proof.session.cartId !== input.cartId ||
      !proof.session.grantId ||
      !proof.session.principalId
    )
      return { ok: false };
    return {
      ok: true,
      authority: {
        [authorityBrand]: true,
        session: proof.session,
        sessionId: input.sessionId,
        userId: input.userId,
      },
    };
  } catch {
    return { ok: false };
  }
}
