import { getCartProofEnvironment } from './cart-runtime-env';
import { cartSessionCookieName } from './principal';
import {
  CART_SESSION_PROOF_VERSION,
  verifyCartSessionProof,
} from './session-proof';

export type SharedCartOrderProofResult =
  | { ok: true; principalId: string }
  | { ok: false };

/**
 * Every cart proof presented with the request, checked independently:
 * a malformed or stale candidate must not mask a valid one.
 */
function presentedCartProofs(request: Request, merchantId: string): string[] {
  const candidates = new Set<string>();
  const headerProof = request.headers.get('x-cart-proof')?.trim();
  if (headerProof) candidates.add(headerProof);
  const authorization = request.headers.get('authorization');
  if (authorization?.toLowerCase().startsWith('bearer ')) {
    const bearer = authorization.slice(7).trim();
    if (bearer) candidates.add(bearer);
  }
  const cookieName = cartSessionCookieName(merchantId);
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const [name, ...rest] = part.split('=');
    // Collect every merchant-namespaced cart session cookie, not only
    // the submitted merchant's: a cookie scoped to merchant A presented
    // with a body naming merchant B is still presented cart authority,
    // and the merchant checks below (verified session merchant must
    // equal the submitted merchant) keep it from authorizing B.
    const isCartSessionCookie =
      name?.trim() === cookieName ||
      (name?.trim().startsWith('baci-cart-') ?? false);
    if (isCartSessionCookie && rest.length > 0) {
      try {
        candidates.add(decodeURIComponent(rest.join('=').trim()));
      } catch {
        candidates.add(rest.join('=').trim());
      }
    }
  }
  return [...candidates];
}

function verifyCandidate(proof: string) {
  try {
    return verifyCartSessionProof(proof, {
      environment: getCartProofEnvironment(),
    });
  } catch {
    return null;
  }
}

/**
 * True when the request carries a verified shared-cart session proof
 * for this merchant (device header, Bearer proof, or the merchant
 * session cookie), whether or not it names a particular cart. Used to
 * fail closed when a shared-cart shopper submits an order without its
 * checkout binding: such a request must never fall through to the
 * legacy direct order RPC.
 */
/**
 * True when the request presents cart-proof-shaped material (a cp1
 * candidate via header, Bearer, or the merchant session cookie) even
 * if it no longer verifies — expired, revoked, or forged. Presented
 * but invalid cart authority must fail closed rather than silently
 * downgrade a shared-cart shopper to the legacy order path; only a
 * request with no cart credential at all is an ordinary legacy guest.
 */
export function requestPresentsCartProofMaterial(
  request: Request,
  merchantId: string
): boolean {
  return presentedCartProofs(request, merchantId).some((proof) =>
    proof.startsWith(`${CART_SESSION_PROOF_VERSION}.`)
  );
}

export function requestCarriesSharedCartSessionProof(
  request: Request,
  merchantId: string
): boolean {
  for (const proof of presentedCartProofs(request, merchantId)) {
    const verified = verifyCandidate(proof);
    if (
      verified?.ok &&
      verified.session.merchantId === merchantId &&
      verified.session.cartId !== null
    )
      return true;
  }
  return false;
}

/**
 * Verifies the cart session proof presented with a bound order submit.
 * Native clients send `x-cart-proof` from secure device storage; browsers
 * ride the merchant-namespaced session cookie. Only a verified proof for
 * the submitted cart and merchant binds the order to the principal that
 * prepared the checkout session.
 */
export function verifySharedCartOrderProof(
  request: Request,
  input: { merchantId: string; cartId: string }
): SharedCartOrderProofResult {
  // Accept the first candidate that verifies for the submitted cart:
  // a stale header must not mask a valid cookie or Bearer proof.
  for (const proof of presentedCartProofs(request, input.merchantId)) {
    const verified = verifyCandidate(proof);
    if (!verified?.ok) continue;
    const session = verified.session;
    if (
      session.merchantId !== input.merchantId ||
      session.cartId !== input.cartId ||
      !session.principalId
    ) {
      continue;
    }
    return { ok: true, principalId: session.principalId };
  }
  return { ok: false };
}
