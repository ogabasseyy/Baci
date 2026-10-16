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
function presentedCartProofCandidates(
  request: Request,
  merchantId: string
): Array<{ proof: string; scoped: boolean }> {
  const candidates: Array<{ proof: string; scoped: boolean }> = [];
  const push = (proof: string | null, scoped: boolean) => {
    const trimmed = proof?.trim();
    if (!trimmed) return;
    const existing = candidates.find((entry) => entry.proof === trimmed);
    if (existing) {
      existing.scoped = existing.scoped || scoped;
    } else {
      candidates.push({ proof: trimmed, scoped });
    }
  };
  // Header and Bearer [REDACTED] are presented to this route deliberately,
  // so they are always scoped to the submitted merchant.
  push(request.headers.get('x-cart-proof'), true);
  const authorization = request.headers.get('authorization');
  if (authorization?.toLowerCase().startsWith('bearer ')) {
    push(authorization.slice('bearer '.length), true);
  }
  const cookieName = cartSessionCookieName(merchantId);
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const [name, ...rest] = part.split('=');
    if (!name || rest.length === 0) continue;
    const trimmedName = name.trim();
    // Collect every merchant-namespaced cart session cookie so the
    // verification paths can find a proof stored under its own
    // merchant's name; only the submitted merchant's cookie is scoped
    // for the fail-closed legacy check (see
    // requestPresentsCartProofMaterial).
    if (trimmedName === cookieName || trimmedName.startsWith('baci-cart-')) {
      try {
        push(decodeURIComponent(rest.join('=')), trimmedName === cookieName);
      } catch {
        push(rest.join('='), trimmedName === cookieName);
      }
    }
  }
  return candidates;
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

function presentedCartProofs(request: Request, merchantId: string): string[] {
  return presentedCartProofCandidates(request, merchantId).map(
    (entry) => entry.proof
  );
}

export function requestPresentsCartProofMaterial(
  request: Request,
  merchantId: string
): boolean {
  for (const { proof, scoped } of presentedCartProofCandidates(
    request,
    merchantId
  )) {
    if (!proof.startsWith(`${CART_SESSION_PROOF_VERSION}.`)) continue;
    if (scoped) return true;
    // Material stored under another merchant's cookie only counts
    // when it verifiably belongs to the submitted merchant; a stale,
    // expired, or forged cp1 cookie from another store must not block
    // an ordinary legacy guest checkout here.
    const verified = verifyCandidate(proof);
    if (verified?.ok && verified.session.merchantId === merchantId) {
      return true;
    }
  }
  return false;
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
