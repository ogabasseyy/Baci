import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import { getCartSessionSecret } from './cart-runtime-env';

export const HANDOFF_TOKEN_VERSION = 'ch1';

export const HANDOFF_TOKEN_AUDIENCE = 'baci-cart-handoff';

export const MIN_SECRET_LENGTH = 32;

export class HandoffConfigError extends Error {
  constructor() {
    super('Cart handoff secret is not provisioned');
    this.name = 'HandoffConfigError';
  }
}

export type HandoffDestinationType = 'web' | 'native';

export type HandoffMobileApp = 'storefront';

export interface HandoffDestination {
  type: HandoffDestinationType;
  /** Required for native destinations; validated against known apps. */
  app?: HandoffMobileApp;
}

export interface HandoffTokenInput {
  merchantId: string;
  cartId: string;
  principalId: string;
  operationId: string;
  destination: HandoffDestination;
}

export interface HandoffTokenPayload extends HandoffTokenInput {
  v: typeof HANDOFF_TOKEN_VERSION;
  aud: typeof HANDOFF_TOKEN_AUDIENCE;
  env: string;
}

export type HandoffChoice = 'connect' | 'merge' | 'keep_existing';

export interface HandoffMerchantRef {
  slug: string;
  customDomain: string | null;
  rootDomain: string;
}

/**
 * Domain-separated handoff signing key: derived from the cart master
 * secret with an HMAC label, so handoff tokens and session proofs
 * never share a signing key even though they share provisioning.
 * Rotating the master still rotates both (by design, pre-activation),
 * but a leaked handoff signing context cannot forge session proofs.
 */
export function deriveHandoffSigningKey(masterSecret: string): string {
  return createHmac('sha256', masterSecret)
    .update('baci-cart-handoff-signing:v1')
    .digest('hex');
}

export function requireSecret(secret: string | undefined): string {
  const normalized = secret?.trim() ? secret.trim() : getCartSessionSecret();
  if (!normalized || normalized.length < MIN_SECRET_LENGTH) {
    throw new HandoffConfigError();
  }
  return deriveHandoffSigningKey(normalized);
}

export function encodeCanonicalPayload(
  input: HandoffTokenInput,
  env: string
): string {
  const payload: HandoffTokenPayload = {
    aud: HANDOFF_TOKEN_AUDIENCE,
    cartId: input.cartId,
    destination:
      input.destination.type === 'native'
        ? { app: input.destination.app as HandoffMobileApp, type: 'native' }
        : { type: 'web' },
    env,
    merchantId: input.merchantId,
    operationId: input.operationId,
    principalId: input.principalId,
    v: HANDOFF_TOKEN_VERSION,
  };
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

export function signTokenPayload(encoded: string, secret: string): string {
  return createHmac('sha256', secret)
    .update(`${HANDOFF_TOKEN_VERSION}.${encoded}`)
    .digest('base64url');
}

export function signaturesEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, 'base64url');
  const rightBytes = Buffer.from(right, 'base64url');
  if (leftBytes.length !== rightBytes.length) return false;
  return timingSafeEqual(leftBytes, rightBytes);
}

/**
 * Mints a deterministic handoff grant token. Identical inputs yield the
 * identical token, so issue replays converge on one grant row without
 * storing any secret: the database keeps only the token hash. Expiry
 * and single-use live on the row, never in the token.
 */
export function createHandoffToken(
  input: HandoffTokenInput & { environment: string },
  secret?: string
): string {
  const resolved = requireSecret(secret);
  const encoded = encodeCanonicalPayload(input, input.environment);
  return `${HANDOFF_TOKEN_VERSION}.${encoded}.${signTokenPayload(encoded, resolved)}`;
}

/** Stable hex digest identifying a grant row. Never reversible. */
export function hashHandoffToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Verifies a handoff token and returns its bound inputs, or null when
 * the token is malformed, forged, or minted for another environment.
 */
export function parseHandoffToken(
  token: string,
  secret: string | undefined,
  environment: string
): HandoffTokenInput | null {
  const resolved = requireSecret(secret);
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== HANDOFF_TOKEN_VERSION) return null;
  const [, encoded, signature] = parts;
  if (
    !encoded ||
    !signature ||
    !signaturesEqual(signTokenPayload(encoded, resolved), signature)
  ) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  if (parsed.v !== HANDOFF_TOKEN_VERSION) return null;
  if (parsed.aud !== HANDOFF_TOKEN_AUDIENCE) return null;
  if (parsed.env !== environment) return null;
  const destination = parsed.destination;
  if (!isRecord(destination)) return null;
  if (destination.type === 'native') {
    if (destination.app !== 'storefront') {
      return null;
    }
  } else if (destination.type !== 'web') {
    return null;
  }
  for (const field of [
    'merchantId',
    'cartId',
    'principalId',
    'operationId',
  ] as const) {
    if (typeof parsed[field] !== 'string' || !parsed[field]) return null;
  }
  return {
    cartId: parsed.cartId as string,
    destination:
      destination.type === 'native'
        ? { app: destination.app as HandoffMobileApp, type: 'native' }
        : { type: 'web' },
    merchantId: parsed.merchantId as string,
    operationId: parsed.operationId as string,
    principalId: parsed.principalId as string,
  };
}

/**
 * Continuation URL for a handoff grant. The pairing secret travels in
 * the URL fragment, which browsers never send to the server — raw
 * secrets stay out of access logs. Follows the receipts-claim host
 * rule: custom domain first, else the slug subdomain.
 */
export function buildHandoffContinueUrl(
  merchant: HandoffMerchantRef,
  token: string,
  handoffId: string
): string {
  const host =
    merchant.customDomain?.trim().toLowerCase() ||
    `${merchant.slug}.${merchant.rootDomain}`.toLowerCase();
  return `https://${host}/cart#handoff=${encodeURIComponent(token)}&hid=${encodeURIComponent(handoffId)}`;
}

/**
 * Classifies the redemption surface from the Origin header: an
 * http(s) Origin means web, anything else (native fetch, curl) means
 * native. This label alone is not caller verification — the redeem
 * route binds it to the proof transport (native redemption requires
 * the device-held Bearer proof; web redemption requires an
 * allowlisted merchant Origin). The trust boundary remains the
 * signed pairing token, the verified cart proof principal, and the
 * SQL grant checks; the destination only selects which client
 * surface may complete the pairing.
 */
export function detectHandoffCaller(
  origin: string | null
): HandoffDestinationType {
  return origin && /^https?:/i.test(origin) ? 'web' : 'native';
}

/**
 * Approved web origins for handoff redemption: the slug subdomain, the
 * merchant custom domain, and the platform root host (slug storefronts).
 * Merchant origins are https-only; loopback origins are accepted only
 * outside production so a plain-HTTP or local development host can never
 * redeem a handoff for a real merchant domain.
 */
export function isHandoffWebOriginAllowed(
  origin: string | null,
  merchant: HandoffMerchantRef,
  environment: string | undefined = process.env.NODE_ENV
): boolean {
  if (!origin) return false;
  const normalized = origin.trim().toLowerCase();
  const root = merchant.rootDomain.toLowerCase();
  const slug = merchant.slug.toLowerCase();
  const allowed = new Set([`https://${slug}.${root}`, `https://${root}`]);
  if (merchant.customDomain?.trim()) {
    const custom = merchant.customDomain.trim().toLowerCase();
    allowed.add(`https://${custom}`);
  }
  if (allowed.has(normalized)) return true;
  if (environment === 'production') return false;
  try {
    const url = new URL(normalized);
    const host = url.hostname;
    return (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === `${slug}.localhost`
    );
  } catch {
    return false;
  }
}
