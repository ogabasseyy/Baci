import type { CartCommand } from '@baci/shared/cart';
import type { CartSessionVerification } from './session-proof';

declare const cartPrincipalBrand: unique symbol;

/**
 * Branded cart authority. Only `resolveCartPrincipal` — which combines a
 * verified session proof with independently resolved merchant context —
 * can construct one. Arbitrary callers cannot instantiate authority from
 * body fields.
 */
export interface CartPrincipal {
  readonly [cartPrincipalBrand]?: never;
  merchantId: string;
  cartId: string | null;
  grantId: string | null;
  principalId: string;
  scope: 'bootstrap' | 'session';
  allowedOperations: CartCommand['type'][];
  expiresAt: string;
}

export type ResolveCartPrincipalError =
  | 'missing_proof'
  | 'invalid_proof'
  | 'expired_proof'
  | 'merchant_unresolved'
  | 'merchant_mismatch';

export type ResolveCartPrincipalResult =
  | { ok: true; principal: CartPrincipal }
  | { error: ResolveCartPrincipalError; ok: false };

export interface CartMerchantContext {
  id: string;
  slug: string;
}

export interface ResolveCartPrincipalDeps {
  resolveMerchant: (request: Request) => Promise<CartMerchantContext | null>;
  verify: (proof: string) => Promise<CartSessionVerification>;
  readCookie?: (request: Request, name: string) => string | null;
}

/**
 * Host-only session cookie name, namespaced by merchant so two stores on
 * one shared host keep separate sessions and tabs cannot collide.
 */
export function cartSessionCookieName(merchantIdentifier: string): string {
  return `baci-cart-${merchantIdentifier.trim().toLowerCase()}`;
}

export function readCookieFromRequest(
  request: Request,
  name: string
): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    const key = part.slice(0, separator).trim();
    if (key !== name) continue;
    const value = part.slice(separator + 1).trim();
    return value ? value : null;
  }
  return null;
}

/**
 * Builds cart authority from the trusted merchant context and the
 * merchant-namespaced session proof. Body fields never confer authority.
 */
export async function resolveCartPrincipal(
  request: Request,
  deps: ResolveCartPrincipalDeps
): Promise<ResolveCartPrincipalResult> {
  const merchant = await deps.resolveMerchant(request);
  if (!merchant) {
    return { error: 'merchant_unresolved', ok: false };
  }

  const readCookie = deps.readCookie ?? readCookieFromRequest;
  const proof = readCookie(request, cartSessionCookieName(merchant.slug));
  if (!proof) {
    return { error: 'missing_proof', ok: false };
  }

  const verification = await deps.verify(proof);
  if (!verification.ok) {
    if (verification.error === 'expired_proof') {
      return { error: 'expired_proof', ok: false };
    }
    return { error: 'invalid_proof', ok: false };
  }

  const session = verification.session;
  if (session.merchantId !== merchant.id) {
    return { error: 'merchant_mismatch', ok: false };
  }
  const hasCart = session.cartId !== null;
  const hasGrant = session.grantId !== null;
  if (hasCart !== hasGrant) {
    return { error: 'invalid_proof', ok: false };
  }

  return {
    ok: true,
    principal: {
      allowedOperations: session.allowedOperations,
      cartId: session.cartId,
      expiresAt: session.expiresAt,
      grantId: session.grantId,
      merchantId: session.merchantId,
      principalId: session.principalId,
      scope: hasCart ? 'session' : 'bootstrap',
    },
  };
}
