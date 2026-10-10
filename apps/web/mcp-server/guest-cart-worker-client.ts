import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export class GuestCartWorkerTokenError extends Error {
  override readonly name = 'GuestCartWorkerTokenError';
}

const EXPECTED_WORKER_ROLE = 'mcp_guest_cart_worker';
// Supabase JWT signing keys support all three: ES256, RS256, HS256.
const SUPPORTED_SIGNING_ALGORITHMS = new Set(['ES256', 'HS256', 'RS256']);
// Minimum remaining token lifetime at startup: the long-running server
// never refreshes the capability, so a token dying mid-deploy would
// degrade carts until an operator rotates and restarts. Refusing a
// short runway at deploy time forces rotation onto the deploy path
// (see the README rotation runbook) instead of a silent expiry later.
const MIN_TOKEN_RUNWAY_MS = 24 * 60 * 60 * 1000;

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

// Expiry/role/runway pre-check only, mirroring the gigl worker client:
// it never verifies the JWT signature or issuer. A mis-issued token
// surfaces at PostgREST; this fails closed on the cases checkable
// offline. Messages stay static: claims are attacker-influenced bytes.
function assertWorkerCapability(token: string): void {
  let header: Record<string, unknown>;
  let claims: Record<string, unknown>;
  try {
    if (token.split('.').length !== 3) throw new Error('not a JWT');
    header = parseJwtPart(token, 0);
    claims = parseJwtPart(token, 1);
  } catch {
    throw new GuestCartWorkerTokenError(
      'Guest-cart worker token is missing, malformed, or not scoped to the cart worker role'
    );
  }
  if (
    typeof header.alg !== 'string' ||
    !SUPPORTED_SIGNING_ALGORITHMS.has(header.alg) ||
    claims.role !== EXPECTED_WORKER_ROLE ||
    typeof claims.exp !== 'number' ||
    !(claims.exp * 1000 > Date.now())
  ) {
    throw new GuestCartWorkerTokenError(
      'Guest-cart worker token is missing, expired, or not scoped to the cart worker role'
    );
  }
  if (!(claims.exp * 1000 > Date.now() + MIN_TOKEN_RUNWAY_MS)) {
    throw new GuestCartWorkerTokenError(
      'Guest-cart worker token expires within 24 hours; rotate it before deploying'
    );
  }
}

function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/\.$/, '');
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

/**
 * Builds the PostgREST client the guest-cart store persists through. The
 * project anon key stays in the gateway `apikey` position while the
 * offline-minted worker JWT (role claim mcp_guest_cart_worker) travels
 * in the Authorization header — the gateway rejects a custom JWT in the
 * key position before PostgREST can assume the worker role. Refuses
 * expired, mis-scoped, and malformed tokens, tokens without a 24-hour
 * rotation runway, and plaintext non-loopback origins.
 */
export function createGuestCartWorkerClient(
  url: string,
  anonKey: string | undefined,
  workerToken: string | undefined
): SupabaseClient {
  // Compose secrets and env files trail newlines: trim before any
  // shape check so a rotated secret is never refused for whitespace.
  const trimmedToken = workerToken?.trim();
  assertWorkerCapability(trimmedToken ?? '');
  const trimmedAnon = anonKey?.trim();
  if (!trimmedAnon) {
    throw new GuestCartWorkerTokenError(
      'Guest-cart worker client is missing the project anon key'
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
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
  // The parsed URL validated the shape; the client gets the trimmed
  // input verbatim, since URL serialization would append a trailing
  // slash the gateway path join does not expect.
  return createClient(url.trim(), trimmedAnon, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
    global: { headers: { Authorization: `Bearer ${trimmedToken}` } },
  });
}
