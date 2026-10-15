import { Buffer } from 'node:buffer';
import { createHmac } from 'node:crypto';
import {
  CART_FULL_SESSION_OPERATIONS,
  type CartCommand,
  type VerifiedCartSession,
} from '@baci/shared/cart';
import { z } from 'zod';
import { constantTimeEqual } from '@/lib/constant-time-equal';
import {
  getCartPreviousSessionSecrets,
  getCartSessionSecret,
} from './cart-runtime-env';

export const CART_SESSION_PROOF_VERSION = 'cp1';
/** Absolute session-proof lifetime; renewal requires a live grant check. */
export const CART_SESSION_PROOF_TTL_SECONDS = 7 * 24 * 60 * 60;
/**
 * Expired proofs may only retire device access for one additional day
 * after expiry; beyond that a leaked proof loses revocation power too.
 */
export const CART_REVOCATION_GRACE_SECONDS = 24 * 60 * 60;
/** Clock-skew allowance before a future issuance time looks forged. */
export const CART_PROOF_FUTURE_IAT_LEEWAY_SECONDS = 60;
/** Pre-cart bootstrap proofs live only long enough to create one cart. */
export const CART_BOOTSTRAP_PROOF_TTL_SECONDS = 15 * 60;
export const CART_SESSION_PROOF_AUDIENCE = 'baci:cart-session';

const MIN_SECRET_LENGTH = 32;

const cartOperationSchema = z.enum([
  'add',
  'set_quantity',
  'remove',
  'clear',
  'replace',
  'set_assurance',
  'set_negotiated_price',
]);

export interface CartSessionProofInput {
  merchantId: string;
  cartId: string | null;
  grantId: string | null;
  principalId: string;
  scope: 'bootstrap' | 'session';
  grantExpiresAt?: string;
  /**
   * Operations the backing grant allows. Encoded into the proof so the
   * verified principal carries the grant's actual authority at the
   * TypeScript layer too; SQL still re-checks the grant row on every
   * mutation. Defaults to the full session vocabulary for fresh
   * grants; renewals pass the incoming principal's verified list.
   */
  allowedOperations?: readonly CartCommand['type'][];
}

export type CartSessionVerification =
  | { ok: true; session: VerifiedCartSession }
  | {
      error:
        | 'invalid_proof'
        | 'expired_proof'
        | 'wrong_environment'
        | 'wrong_audience';
      ok: false;
    };

export class CartSessionConfigError extends Error {
  constructor(message = 'missing_cart_session_secret') {
    super(message);
    this.name = 'CartSessionConfigError';
  }
}

const proofPayloadSchema = z.strictObject({
  aud: z.string().min(1).max(128),
  cartId: z.uuid().nullable(),
  env: z.string().min(1).max(64),
  exp: z.number().int().positive(),
  grantId: z.uuid().nullable(),
  iat: z.number().int().positive(),
  merchantId: z.uuid(),
  // Grant operations encoded at issuance; absent on proofs minted
  // before this claim existed. Those legacy proofs fail closed with
  // no mutation operations until the server re-issues them.
  ops: z.array(cartOperationSchema).max(7).optional(),
  principalId: z.string().min(1).max(128),
  scope: z.enum(['bootstrap', 'session']),
  v: z.literal(CART_SESSION_PROOF_VERSION),
});

type ProofPayload = z.infer<typeof proofPayloadSchema>;

function requireSecret(secret: string | undefined): string {
  const normalized = secret?.trim() ? secret.trim() : getCartSessionSecret();
  if (!normalized || normalized.length < MIN_SECRET_LENGTH) {
    throw new CartSessionConfigError();
  }
  return normalized;
}

function signPayload(payload: string, secret: string): string {
  return createHmac('sha256', secret)
    .update(`${CART_SESSION_PROOF_VERSION}.${payload}`)
    .digest('base64url');
}

function encodePayload(payload: ProofPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

function decodePayload(payload: string): ProofPayload | null {
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(payload, 'base64url').toString('utf8')
    );
    const result = proofPayloadSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/**
 * Issues a signed session proof binding merchant, cart, grant and guest
 * principal. The proof is opaque transport authority: database RLS and the
 * grant row still authorize every operation.
 */
/**
 * Cookie lifetime for a session proof: never outlive the proof TTL, and
 * never outlive the cart whose grant the proof authenticates. A
 * non-positive result means the cart is already expired — callers must
 * not set the cookie at all.
 */
export function cartSessionCookieMaxAge(
  cartExpiresAtIso: string,
  now = new Date()
): number {
  return Math.min(
    CART_SESSION_PROOF_TTL_SECONDS,
    Math.floor((Date.parse(cartExpiresAtIso) - now.getTime()) / 1000)
  );
}

export function issueCartSessionProof(
  input: CartSessionProofInput,
  options: {
    secret?: string;
    now?: Date;
    environment: string;
    audience?: string;
  }
): string {
  const secret = requireSecret(options.secret);
  const now = options.now ?? new Date();
  const issuedAt = Math.floor(now.getTime() / 1000);

  if (input.scope === 'bootstrap' && (input.cartId ?? input.grantId)) {
    throw new Error('Bootstrap proofs must not carry a cart or grant');
  }
  if (input.scope === 'session' && !(input.cartId && input.grantId)) {
    throw new Error('Session proofs require a cart and grant');
  }

  const ttl =
    input.scope === 'bootstrap'
      ? CART_BOOTSTRAP_PROOF_TTL_SECONDS
      : CART_SESSION_PROOF_TTL_SECONDS;
  let expiresAt = issuedAt + ttl;
  if (input.grantExpiresAt) {
    const grantExpiry = Math.floor(Date.parse(input.grantExpiresAt) / 1000);
    if (!Number.isFinite(grantExpiry) || grantExpiry <= issuedAt) {
      throw new Error('Cannot issue a proof past grant expiry');
    }
    expiresAt = Math.min(expiresAt, grantExpiry);
  }

  const payload: ProofPayload = {
    aud: options.audience ?? CART_SESSION_PROOF_AUDIENCE,
    cartId: input.cartId,
    env: options.environment,
    exp: expiresAt,
    grantId: input.grantId,
    iat: issuedAt,
    merchantId: input.merchantId,
    ...(input.scope === 'session'
      ? {
          ops: [
            ...(input.allowedOperations ?? CART_FULL_SESSION_OPERATIONS),
          ] as CartCommand['type'][],
        }
      : {}),
    principalId: input.principalId,
    scope: input.scope,
    v: CART_SESSION_PROOF_VERSION,
  };
  const encoded = encodePayload(payload);
  return `${CART_SESSION_PROOF_VERSION}.${encoded}.${signPayload(encoded, secret)}`;
}

/**
 * Verifies signature, environment, audience and expiry. A valid proof
 * still requires current database-grant validation before any mutation.
 */
function verifyCartProof(
  proof: string,
  options: {
    secret?: string;
    now?: Date;
    environment: string;
    audience?: string;
    previousSecrets?: string[];
  },
  allowExpired = false
): CartSessionVerification {
  const secret = requireSecret(options.secret);
  const parts = proof.split('.');
  if (parts.length !== 3 || parts[0] !== CART_SESSION_PROOF_VERSION) {
    return { error: 'invalid_proof', ok: false };
  }
  const [, encoded, signature] = parts;
  const payload = decodePayload(encoded);
  if (!payload) {
    return { error: 'invalid_proof', ok: false };
  }

  const candidates = [
    secret,
    ...(options.previousSecrets ?? getCartPreviousSessionSecrets()),
  ].filter((candidate) => candidate.trim().length >= MIN_SECRET_LENGTH);
  const signed = candidates.some((candidate) =>
    constantTimeEqual(signPayload(encoded, candidate), signature)
  );
  if (!signed) {
    return { error: 'invalid_proof', ok: false };
  }
  if (payload.env !== options.environment) {
    return { error: 'wrong_environment', ok: false };
  }
  if (payload.aud !== (options.audience ?? CART_SESSION_PROOF_AUDIENCE)) {
    return { error: 'wrong_audience', ok: false };
  }
  const now = Math.floor((options.now ?? new Date()).getTime() / 1000);
  // Reject proofs issued in the future (beyond clock-skew leeway) or
  // with an issuance after their own expiry: server minting never
  // produces either, so both mark a foreign or corrupted issuer.
  if (
    payload.iat > now + CART_PROOF_FUTURE_IAT_LEEWAY_SECONDS ||
    payload.iat > payload.exp
  ) {
    return { error: 'invalid_proof', ok: false };
  }
  if (!allowExpired && payload.exp <= now) {
    return { error: 'expired_proof', ok: false };
  }
  if (allowExpired && payload.exp < now - CART_REVOCATION_GRACE_SECONDS) {
    return { error: 'expired_proof', ok: false };
  }

  const session: VerifiedCartSession = {
    // The proof carries the grant's operations from issuance, so the
    // TypeScript authority is exactly the grant's — a restricted grant
    // stays restricted at every layer, not only in SQL. Proofs minted
    // before the ops claim existed carry no mutation authority here;
    // the server must re-issue them with the grant's verified list.
    allowedOperations:
      payload.scope === 'session' ? [...(payload.ops ?? [])] : [],
    cartId: payload.cartId,
    expiresAt: new Date(payload.exp * 1000).toISOString(),
    grantId: payload.grantId,
    merchantId: payload.merchantId,
    principalId: payload.principalId,
  };
  return { ok: true, session };
}

/** Normal cart authority always rejects expired proofs. */
export function verifyCartSessionProof(
  proof: string,
  options: Parameters<typeof verifyCartProof>[1]
): CartSessionVerification {
  return verifyCartProof(proof, options);
}
/**
 * Expired signed proofs identify access to retire, never authority to
 * read or mutate a cart — and only within the post-expiry grace window
 * above, so a leaked proof cannot revoke forever.
 */
export function verifyCartSessionProofForRevocation(
  proof: string,
  options: Parameters<typeof verifyCartProof>[1]
): CartSessionVerification {
  return verifyCartProof(proof, options, true);
}
