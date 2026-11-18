import { createHash } from 'node:crypto';
import type { NextRequest } from 'next/server';
import type { RateLimitConfig, RateLimitResult } from './rate-limit';
import { checkMemoryRateLimit } from './rate-limit-memory';

type ApplyRateLimit = (
  identifier: string,
  pattern: string,
  config: RateLimitConfig
) => Promise<RateLimitResult>;

// The shape of an access token (three base64url segments). Shape only: the
// quiz route verifies the token; this just decides which bucket is charged.
const BEARER_ACCESS_TOKEN_PATTERN =
  /^Bearer\s+([\w-]{10,}\.[\w-]{10,}\.[\w-]{10,})\s*$/i;

// Phones on one mobile carrier share a public address, so a per-address
// budget throttles real players long before it throttles an attacker. This
// ceiling only has to stop one address rotating made-up tokens to mint fresh
// buckets. It is counted in memory on purpose: it is per server instance (so
// the true ceiling is higher), costs no Redis command on the hottest quiz
// paths, and a flood guard does not need an exact count.
const QUIZ_PLAYER_ADDRESS_CEILING: RateLimitConfig = {
  maxRequests: 6_000,
  windowMs: 60_000,
};
const QUIZ_PLAYER_ADDRESS_CEILING_PATTERN = 'quiz-player:address-ceiling';

export function isQuizPlayerPath(pathname: string): boolean {
  return pathname === '/api/quiz' || pathname.startsWith('/api/quiz/');
}

/**
 * Pre-authentication rate limiting for the quiz app API.
 *
 * A request that carries an access token is charged to a bucket keyed by a
 * hash of that token (never the raw token), so each player has their own
 * budget whatever address they share. Returns null when the request carries
 * no access token (browser sessions): the caller then keeps the per-address
 * bucket.
 *
 * The per-player buckets use the fixed-window counter: two Redis commands
 * per request instead of the sliding window's four, on the busiest paths.
 */
export function checkQuizPlayerRateLimit(
  request: NextRequest,
  pattern: string,
  config: RateLimitConfig,
  addressIdentifier: string,
  applyRateLimit: ApplyRateLimit
): Promise<RateLimitResult | null> {
  const token = request.headers
    .get('authorization')
    ?.match(BEARER_ACCESS_TOKEN_PATTERN)?.[1];
  if (!token) return Promise.resolve(null);

  const ceiling = checkMemoryRateLimit(
    addressIdentifier,
    QUIZ_PLAYER_ADDRESS_CEILING_PATTERN,
    QUIZ_PLAYER_ADDRESS_CEILING
  );
  if (!ceiling.allowed) return Promise.resolve(ceiling);

  return applyRateLimit(
    `quiz-player:${createHash('sha256').update(token).digest('hex')}`,
    pattern,
    { ...config, fixedWindow: true }
  );
}
