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

function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/\.$/, '');
}

// Same Supabase project the shopping tools use; the GIGL worker pins
// this same host for the same reason.
const EXPECTED_SUPABASE_HOST = 'aivqthbxdshhltbwipbr.supabase.co';

function isLoopbackHostname(hostname: string): boolean {
  let host = normalizeHostname(hostname);
  // URL keeps IPv6 brackets on .hostname ([::1]); strip them, or the
  // loopback comparison below never matches a real parsed URL.
  if (host.startsWith('[') && host.endsWith(']'))
    host = host.slice(1, -1);
  if (host === 'localhost' || host === '::1' || host === '0.0.0.0')
    return true;
  // IPv4-mapped ::ffff:127.x: the tail arrives hexified (7f00:1) from
  // URL normalization, so match the high byte, not dotted text.
  // Developers bind these alternates to dodge port clashes; none of
  // them leave the host. Shorthand like 127.1 already normalized to
  // dotted quad before this runs.
  if (host.startsWith('::ffff:')) {
    const tail = host.slice('::ffff:'.length);
    if (tail.includes('.'))
      return tail.startsWith('127.') && tail.split('.').length === 4;
    const firstWord = Number.parseInt(tail.split(':')[0] ?? '', 16);
    return Number.isInteger(firstWord) && firstWord >> 8 === 0x7f;
  }
  const parts = host.split('.');
  return (
    parts.length === 4 &&
    parts[0] === '127' &&
    parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
  );
}

// MCP_GUEST_CART_SUPABASE_ORIGIN_ALLOWLIST (comma-separated hostnames,
// no scheme or port) EXTENDS the production pin for preview, local, and
// test origins — it can only add origins, never remove the pin — and
// only when NODE_ENV is not production. Production ignores the
// extension entirely: a stale preview entry plus a mistyped URL must
// never widen the pin where the token has real capability.
function assertAllowedSupabaseHost(
  hostname: string,
  env: Readonly<Record<string, string | undefined>>
): void {
  const allowlist =
    (env.NODE_ENV ?? '').trim().toLowerCase() === 'production'
      ? ''
      : (env.MCP_GUEST_CART_SUPABASE_ORIGIN_ALLOWLIST ?? '');
  const allowedOrigins = new Set(
    allowlist
      .split(',')
      .map((entry) => normalizeHostname(entry))
      .filter((entry) => entry !== '')
  );
  allowedOrigins.add(EXPECTED_SUPABASE_HOST);
  if (!allowedOrigins.has(normalizeHostname(hostname))) {
    throw new GuestCartWorkerTokenError(
      'Guest-cart worker database URL host is not an allowed origin'
    );
  }
}

/**
 * Builds the PostgREST client the guest-cart store persists through. The
 * project anon key stays in the gateway `apikey` position while the
 * offline-minted worker JWT (role claim mcp_guest_cart_worker) travels
 * in the Authorization header — the gateway rejects a custom JWT in the
 * key position before PostgREST can assume the worker role. Refuses
 * expired, mis-scoped, and malformed tokens, tokens without a 24-hour
 * rotation runway, plaintext non-loopback origins, and (outside
 * loopback, which never leaves the host) any Supabase host other than
 * the production pin plus the non-production allowlist below.
 */
export function createGuestCartWorkerClient(
  url: string,
  anonKey: string | undefined,
  workerToken: string | undefined,
  env: Readonly<Record<string, string | undefined>> = process.env
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
  // Loopback never leaves the host, so plaintext stays allowed for
  // local Supabase and no pin applies. Anywhere else the worker JWT
  // would travel to the named origin, so require https and pin the
  // host: a mistyped or substituted URL must fail here rather than
  // exfiltrate a replayable capability.
  if (!isLoopbackHostname(parsed.hostname)) {
    if (parsed.protocol !== 'https:') {
      throw new GuestCartWorkerTokenError(
        'Guest-cart worker token requires an https database URL outside loopback'
      );
    }
    assertAllowedSupabaseHost(parsed.hostname, env);
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
