import { getCartProofEnvironment } from './cart-runtime-env';
import { cartSessionCookieName } from './principal';
import { readCartProofFromRequest } from './request-context';
import { verifyCartSessionProof } from './session-proof';

export type SharedCartOrderProofResult =
  | { ok: true; principalId: string }
  | { ok: false };

/**
 * Verifies the cart session proof presented with a bound order submit.
 * Native clients send `x-cart-proof` from secure device storage; browsers
 * ride the merchant-namespaced session cookie. Only a verified proof for
 * the submitted cart and merchant binds the order to the principal that
 * prepared the checkout session.
 */
export function verifySharedCartOrderProof(
  request: Request,
  input: { merchantId: string; merchantSlug: string; cartId: string }
): SharedCartOrderProofResult {
  const headerProof = request.headers.get('x-cart-proof')?.trim();
  const proof =
    headerProof ||
    readCartProofFromRequest(
      request,
      cartSessionCookieName(input.merchantSlug)
    );
  if (!proof) return { ok: false };
  const verified = verifyCartSessionProof(proof, {
    environment: getCartProofEnvironment(),
  });
  if (!verified.ok) return { ok: false };
  const session = verified.session;
  if (
    session.merchantId !== input.merchantId ||
    session.cartId !== input.cartId ||
    !session.principalId
  ) {
    return { ok: false };
  }
  return { ok: true, principalId: session.principalId };
}
