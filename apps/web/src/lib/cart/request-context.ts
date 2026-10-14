import {
  type CartRouteMerchant,
  type ResolveCartMerchantDeps,
  resolveCartMerchant,
} from './merchant-resolution';
import {
  type CartPrincipal,
  readCookieFromRequest,
  resolveCartPrincipal,
} from './principal';
import type { CartRouteErrorCode } from './response';
import {
  CART_SESSION_PROOF_VERSION,
  CartSessionConfigError,
  type CartSessionVerification,
} from './session-proof';

/**
 * Native clients present the cart proof as `Authorization: Bearer cp1…`
 * (secure device storage); browsers use the merchant-namespaced cookie.
 * Only cp1-prefixed Bearer values are cart proofs — Supabase JWTs and
 * other schemes fall through to the cookie, so account credentials
 * never enter the cart flow.
 */
export type ReadCartJsonBodyResult =
  | { body: unknown; ok: true }
  | { ok: false };

/**
 * Lenient JSON body reader: an absent body parses as an empty object so
 * bootstrap accepts bare POSTs, while malformed JSON fails without
 * throwing. Strict Zod schemas still reject unexpected shapes.
 */
export async function readCartJsonBody(
  request: Request
): Promise<ReadCartJsonBodyResult> {
  const text = await request.text();
  if (!text.trim()) {
    return { body: {}, ok: true };
  }
  try {
    return { body: JSON.parse(text) as unknown, ok: true };
  } catch {
    return { ok: false };
  }
}

export function readCartProofFromRequest(
  request: Request,
  cookieName: string
): string | null {
  const header = request.headers.get('authorization');
  const bearer = header?.match(/^\s*bearer\s+(.+?)\s*$/i)?.[1]?.trim();
  if (bearer?.startsWith(`${CART_SESSION_PROOF_VERSION}.`)) {
    return bearer;
  }
  return readCookieFromRequest(request, cookieName);
}

export interface CartRequestContextDeps {
  merchant: ResolveCartMerchantDeps;
  verify: (
    proof: string
  ) => CartSessionVerification | Promise<CartSessionVerification>;
  requireScope: 'bootstrap' | 'session' | 'any';
  /**
   * Route-specific outcome when the proof scope does not fit: session
   * routes report a missing cart for bootstrap proofs, while the
   * creation route forbids session proofs.
   */
  wrongScopeError: CartRouteErrorCode;
}

export type CartRequestContextResult =
  | { ok: true; merchant: CartRouteMerchant; principal: CartPrincipal }
  | { error: CartRouteErrorCode; ok: false };

/**
 * Builds route authority from trusted merchant resolution plus a
 * verified session proof. Missing proof configuration fails closed
 * with a retryable code; unexpected faults propagate to the route's
 * catch-all so they are logged, never leaked.
 */
export async function resolveCartRequestContext(
  request: Request,
  deps: CartRequestContextDeps
): Promise<CartRequestContextResult> {
  const merchant = await resolveCartMerchant(request, deps.merchant);
  if (!merchant.ok) {
    return merchant;
  }

  let principal: CartPrincipal;
  try {
    const resolved = await resolveCartPrincipal(request, {
      readProof: (candidate, cookieName) =>
        readCartProofFromRequest(candidate, cookieName),
      resolveMerchant: async () => merchant.merchant,
      verify: async (proof) => deps.verify(proof),
    });
    if (!resolved.ok) {
      return resolved;
    }
    principal = resolved.principal;
  } catch (error) {
    if (error instanceof CartSessionConfigError) {
      return { error: 'temporarily_unavailable', ok: false };
    }
    throw error;
  }

  if (deps.requireScope !== 'any' && principal.scope !== deps.requireScope) {
    return { error: deps.wrongScopeError, ok: false };
  }
  return { merchant: merchant.merchant, ok: true, principal };
}

export * from './merchant-resolution';
export * from './request-quota';
