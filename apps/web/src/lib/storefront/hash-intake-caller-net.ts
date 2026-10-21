import 'server-only';
import { createHmac } from 'node:crypto';
import { getStorefrontIntakeToken } from './storefront-intake-token';

/** Derive the durable network-origin budget key for one intake call.
 *
 * The identifier is the proxy's own network signal (see getClientIdentifier),
 * so the DB bucket and the proxy bucket measure the same caller; the HMAC
 * keeps raw IPs out of database rows, logs, and backups. The intake JWT is
 * the HMAC key: it is already required in this module (fail-closed when
 * unprovisioned), server-side only, and rotation simply resets buckets.
 * 'unknown' identifiers hash like any other value, so callers without a
 * usable network signal share one tight bucket per merchant (fail-closed).
 */
export function hashIntakeCallerNet(identifier: string): string {
  return createHmac('sha256', getStorefrontIntakeToken())
    .update(`storefront-intake-net-v1:${identifier}`)
    .digest('hex');
}
