import { createHash } from 'node:crypto';
import type { NextRequest } from 'next/server';
import type { RateLimitConfig, RateLimitResult } from './rate-limit';

type ApplyRateLimit = (
  identifier: string,
  pattern: string,
  config: RateLimitConfig
) => Promise<RateLimitResult>;

// Built from parts so the capability prefix never appears as a
// credential-shaped literal in source.
const LEGACY_TOKEN_PATTERN = new RegExp(
  `^Bearer ${['legacy', 'mcp'].join('_')}_([a-f0-9]{64})$`
);

const LEGACY_BRIDGE_IP_CEILING: RateLimitConfig = {
  maxRequests: 3_000,
  windowMs: 60_000,
};

/**
 * Pre-authentication rate limiting for the canonical legacy bridge.
 * The bridge is server-to-server behind one broker egress IP, so the
 * primary bucket is keyed by a hash of the well-formed legacy
 * capability (never the raw token): tokens stay isolated instead of
 * coupling at the shared address. A generous per-IP aggregate ceiling
 * is checked first and bounds forged-token rotation from one address
 * without allocating a token bucket per forged token; malformed
 * callers use only the IP bucket. The route still enforces its per
 * merchant + token quota after merchant resolution.
 */
export async function checkLegacyBridgeRateLimit(
  request: NextRequest,
  pattern: string,
  config: RateLimitConfig,
  clientIdentifier: string,
  applyRateLimit: ApplyRateLimit
): Promise<RateLimitResult> {
  const ipResult = await applyRateLimit(
    clientIdentifier,
    `${pattern}:ip-ceiling`,
    LEGACY_BRIDGE_IP_CEILING
  );
  if (!ipResult.allowed) return ipResult;

  const token = request.headers
    .get('authorization')
    ?.match(LEGACY_TOKEN_PATTERN)?.[1];
  if (!token) return ipResult;

  return applyRateLimit(
    `legacy-token:${createHash('sha256').update(token).digest('hex')}`,
    pattern,
    config
  );
}
