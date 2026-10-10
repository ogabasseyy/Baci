import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export class GuestCartWorkerTokenError extends Error {
  override readonly name = 'GuestCartWorkerTokenError';
}

const EXPECTED_WORKER_ROLE = 'mcp_guest_cart_worker';
// Supabase JWT signing keys support all three: ES256, RS256, HS256.
const SUPPORTED_SIGNING_ALGORITHMS = new Set(['ES256', 'HS256', 'RS256']);

function parseJwtPart(token: string, index: number): Record<string, unknown> {
  const value = token.split('.')[index];
  if (!value) throw new Error('JWT part is missing');
  const parsed: unknown = JSON.parse(
    Buffer.from(value, 'base64url').toString('utf8')
  );
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('JWT part is invalid');
  }
  return parsed as Record<string, unknown>;
}

// Expiry/role pre-check only, mirroring the gigl worker client: it never
// verifies the JWT signature or issuer. A mis-issued token surfaces at
// PostgREST; this fails closed on the cases checkable offline.
function hasCurrentWorkerCapability(token: string): boolean {
  try {
    if (token.split('.').length !== 3) return false;
    const header = parseJwtPart(token, 0);
    const claims = parseJwtPart(token, 1);
    return (
      typeof header.alg === 'string' &&
      SUPPORTED_SIGNING_ALGORITHMS.has(header.alg) &&
      claims.role === EXPECTED_WORKER_ROLE &&
      typeof claims.exp === 'number' &&
      claims.exp * 1000 > Date.now()
    );
  } catch {
    return false;
  }
}

function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/\.$/, '');
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

/**
 * Builds the PostgREST client the guest-cart store persists through. The
 * token is a worker JWT minted offline (role claim
 * mcp_guest_cart_worker), never the service key: it can invoke only the
 * three cart RPCs. Refuses expired, mis-scoped, and malformed tokens, and
 * refuses to send the token over plaintext to a non-loopback origin.
 * Messages are static: the role claim is attacker-influenced log bytes.
 */
export function createGuestCartWorkerClient(
  url: string,
  workerToken: string | undefined
): SupabaseClient {
  if (!workerToken || !hasCurrentWorkerCapability(workerToken)) {
    throw new GuestCartWorkerTokenError(
      'Guest-cart worker token is missing, expired, or not scoped to the cart worker role'
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new GuestCartWorkerTokenError(
      'Guest-cart worker database URL is invalid'
    );
  }
  if (parsed.username !== '' || parsed.password !== '') {
    throw new GuestCartWorkerTokenError(
      'Guest-cart worker database URL must not embed credentials'
    );
  }
  if (parsed.protocol !== 'https:' && !isLoopbackHostname(parsed.hostname)) {
    throw new GuestCartWorkerTokenError(
      'Guest-cart worker token requires an https database URL outside loopback'
    );
  }
  return createClient(url, workerToken);
}
