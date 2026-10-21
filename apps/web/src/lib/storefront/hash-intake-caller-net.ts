import 'server-only';
import { createHmac } from 'node:crypto';

/** Derive the durable network-origin budget key for one intake call.
 *
 * The identifier is the route's trusted network signal (see
 * getTrustedClientIdentifier), so the DB bucket cannot be rotated by
 * minting header values; the HMAC keeps raw IPs out of database rows,
 * logs, and backups. The key is a dedicated intake-net secret, NOT the
 * intake JWT: the JWT is a bearer credential transmitted on every RPC,
 * so reusing it as key material would let any exposure retroactively
 * reverse every stored hash by IPv4 enumeration. The dedicated secret is
 * never transmitted; rotation resets budgets only. The key must be exactly
 * 64 lowercase hex characters — the shape both deploy workflows generate:
 * the stored hashes stay irreversible only while the key is unguessable,
 * and a length check alone would admit 32 repeated characters or a padded
 * dictionary word, recoverable by offline dictionary attack plus IPv4
 * enumeration after any ledger exposure. Anything else (missing, short,
 * non-hex, surrounding-whitespace-only after stripping) fails closed: the
 * route serves 503, never a degraded unkeyed hash. Reusing the bearer
 * intake JWT as the key is rejected outright: its every-RPC transmission
 * would expose key material.
 * 'unknown' identifiers hash like any other value, so callers without a
 * usable network signal share one tight bucket per merchant (fail-closed).
 */
export function hashIntakeCallerNet(identifier: string): string {
  const key = process.env.SUPABASE_STOREFRONT_INTAKE_NET_KEY?.trim();
  if (!key || !/^[0-9a-f]{64}$/.test(key))
    throw new Error('Storefront intake network key is unavailable');
  if (key === process.env.SUPABASE_STOREFRONT_INTAKE_KEY?.trim())
    throw new Error('Storefront intake network key is unavailable');
  return createHmac('sha256', key)
    .update(`storefront-intake-net-v1:${identifier}`)
    .digest('hex');
}
