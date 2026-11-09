import 'server-only';
import { createHash, createHmac, randomBytes } from 'node:crypto';

/**
 * PiggyVest egress relay (optional). PiggyVest accepts API calls only from
 * whitelisted IPs, and Vercel has no fixed egress IP, so production calls can
 * be forwarded through the VPS relay (vps-workers/jobs/piggyvest-egress-relay).
 *
 * Dark by default: with PIGGYVEST_EGRESS_RELAY_URL and
 * PIGGYVEST_EGRESS_RELAY_SECRET both unset (or invalid), `routeThroughRelay`
 * returns null and every caller keeps its direct request unchanged. Only the
 * production origin is ever rerouted, so Paystack and sandbox calls that share
 * the same transports are untouched. The variables are read from process.env
 * here on purpose; src/env.ts is a frozen boundary.
 *
 * The relay is the source of truth for the signature format
 * (vps-workers/lib/piggyvest-egress-relay-auth.mjs); egress-relay.test.ts and
 * that file's test pin the same vector.
 */

export const PIGGYVEST_PRODUCTION_ORIGIN = 'https://api.piggyvest.business';
export const RELAY_AUTH_HEADER = 'x-baci-relay-auth';
const RELAY_ERROR_HEADER = 'x-baci-relay-error';
const RELAY_UPSTREAM_HEADER = 'x-baci-relay-upstream';
const MIN_SECRET_LENGTH = 32;

export interface PiggyvestEgressRelayConfig {
  origin: string;
  secret: string;
}

export interface RoutedPiggyvestRequest {
  url: string;
  headers: Record<string, string>;
}

/**
 * `maybe-sent`: PiggyVest may have processed the request (timeout, lost
 * connection, unknown response), so money may have moved: indeterminate.
 * `not-sent`: the relay proved it never contacted PiggyVest.
 */
export interface PiggyvestRelayFailure {
  sendState: 'not-sent' | 'maybe-sent';
  code: string;
}

function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]'
  );
}

export function getPiggyvestEgressRelayConfig(
  env: Record<string, string | undefined> = process.env
): PiggyvestEgressRelayConfig | null {
  const rawUrl = env.PIGGYVEST_EGRESS_RELAY_URL?.trim();
  const secret = env.PIGGYVEST_EGRESS_RELAY_SECRET?.trim();
  if (!rawUrl || !secret || secret.length < MIN_SECRET_LENGTH) return null;
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  const secure =
    parsed.protocol === 'https:' ||
    (parsed.protocol === 'http:' && isLoopbackHost(parsed.hostname));
  if (
    !secure ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    (parsed.pathname !== '/' && parsed.pathname !== '')
  )
    return null;
  return { origin: parsed.origin, secret };
}

export function signPiggyvestRelayRequest(input: {
  secret: string;
  method: string;
  target: string;
  body?: string;
  timestamp: number;
  nonce: string;
}): string {
  const bodyHash = createHash('sha256')
    .update(input.body ?? '')
    .digest('hex');
  const signature = createHmac('sha256', input.secret)
    .update(
      [
        'baci-relay-v1',
        String(input.timestamp),
        input.nonce,
        input.method.toUpperCase(),
        input.target,
        bodyHash,
      ].join('\n')
    )
    .digest('hex');
  return `v1.${input.timestamp}.${input.nonce}.${signature}`;
}

/**
 * Returns the relay URL and signed headers for a PiggyVest production
 * request, or null when the request must go direct (relay not configured, or
 * a different origin such as Paystack or the sandbox).
 */
export function routeThroughRelay(
  request: {
    url: string;
    method: string;
    body?: string;
    headers: Record<string, string>;
  },
  options: {
    env?: Record<string, string | undefined>;
    now?: () => number;
    nonce?: () => string;
  } = {}
): RoutedPiggyvestRequest | null {
  const config = getPiggyvestEgressRelayConfig(options.env);
  if (!config) return null;
  let original: URL;
  try {
    original = new URL(request.url);
  } catch {
    return null;
  }
  if (original.origin !== PIGGYVEST_PRODUCTION_ORIGIN) return null;
  // Concatenate onto the origin: a path that normalizes to `//host/...`
  // would otherwise be parsed as a protocol-relative URL and swap the host,
  // sending the PiggyVest credentials to it. The origin must survive.
  const relayUrl = new URL(config.origin + original.pathname + original.search);
  if (relayUrl.origin !== config.origin) return null;
  const target = relayUrl.pathname + relayUrl.search;
  const timestamp = Math.floor((options.now ?? Date.now)() / 1000);
  const nonce = (options.nonce ?? (() => randomBytes(16).toString('hex')))();
  return {
    url: relayUrl.toString(),
    headers: {
      ...request.headers,
      [RELAY_AUTH_HEADER]: signPiggyvestRelayRequest({
        secret: config.secret,
        method: request.method,
        target,
        body: request.body,
        timestamp,
        nonce,
      }),
    },
  };
}

/**
 * Classifies a response to a relay-routed request. Returns null only for a
 * genuine PiggyVest answer passed through by the relay. Anything the relay
 * itself produced, and anything that did not come from the relay at all (a
 * proxy or CDN error page), is a failure and must never be read as a
 * PiggyVest decision such as a 401, 404 or 5xx.
 */
export function classifyRelayResponse(
  response: Response
): PiggyvestRelayFailure | null {
  const code = response.headers.get(RELAY_ERROR_HEADER);
  const upstream = response.headers.get(RELAY_UPSTREAM_HEADER);
  if (!code) {
    return upstream === 'sent'
      ? null
      : { sendState: 'maybe-sent', code: 'relay_unexpected_response' };
  }
  // Only an explicit `not-sent` on a non-timeout status is definite; an
  // unknown or missing marker stays indeterminate.
  const definite = upstream === 'not-sent' && response.status !== 504;
  return { sendState: definite ? 'not-sent' : 'maybe-sent', code };
}
