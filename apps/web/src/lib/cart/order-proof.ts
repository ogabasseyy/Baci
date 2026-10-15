import { getCartProofEnvironment } from './cart-runtime-env';
import { cartSessionCookieName } from './principal';
import { readCartProofFromRequest } from './request-context';
import { verifyCartSessionProof } from './session-proof';

export type SharedCartOrderProofResult =
  | { ok: true; principalId: string }
  | { ok: false };

/**
 * True when the request carries a verified shared-cart session proof
 * for this merchant (device header, Bearer proof, or the merchant
 * session cookie), whether or not it names a particular cart. Used to
 * fail closed when a shared-cart shopper submits an order without its
 * checkout binding: such a request must never fall through to the
 * legacy direct order RPC.
 */
export function requestCarriesSharedCartSessionProof(
  request: Request,
  merchantId: string
): boolean {
  // Check every presented candidate independently: a malformed or
  // stale header must not mask a valid cookie (or vice versa).
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
    if (name?.trim() === cookieName && rest.length > 0) {
      try {
        candidates.add(decodeURIComponent(rest.join('=').trim()));
      } catch {
        candidates.add(rest.join('=').trim());
      }
    }
  }
  for (const proof of candidates) {
    let verified: ReturnType<typeof verifyCartSessionProof>;
    try {
      verified = verifyCartSessionProof(proof, {
        environment: getCartProofEnvironment(),
      });
    } catch {
      // Unverifiable configuration or malformed candidates simply do
      // not establish shared-cart authority for this check.
      continue;
    }
    if (
      verified.ok &&
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
  const headerProof = request.headers.get('x-cart-proof')?.trim();
  const proof =
    headerProof ||
    readCartProofFromRequest(request, cartSessionCookieName(input.merchantId));
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
