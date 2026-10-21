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
 * never transmitted; rotation resets budgets only. Missing/empty fails
 * closed (the route serves 503, never a degraded unkeyed hash).
 * 'unknown' identifiers hash like any other value, so callers without a
 * usable network signal share one tight bucket per merchant (fail-closed).
 */
export function hashIntakeCallerNet(identifier: string): string {
  const key = process.env.SUPABASE_STOREFRONT_INTAKE_NET_KEY;
  if (!key) throw new Error('Storefront intake network key is unavailable');
  return createHmac('sha256', key)
    .update(`storefront-intake-net-v1:${identifier}`)
    .digest('hex');
}
