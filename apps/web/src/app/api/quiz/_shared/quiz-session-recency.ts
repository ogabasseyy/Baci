import { createHash } from 'node:crypto';

// Remembers, per server instance, which access tokens Supabase Auth confirmed
// recently. The answer route verifies the token's signature on every request
// and asks Supabase Auth about the session at most once per token per
// RECENT_SESSION_CHECK_TTL_MS, so a signed-out or revoked session stops
// answering within about a minute instead of at token expiry, without a
// Supabase Auth round trip on every answer.

export const RECENT_SESSION_CHECK_TTL_MS = 60_000;
const MAX_TRACKED_TOKENS = 50_000;

// Insertion order is age order: a token is re-inserted on every new check.
const checkedAtByToken = new Map<string, number>();

// Tokens are kept as hashes so a memory dump of this map holds no credential.
function keyFor(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function hasRecentSessionCheck(
  token: string,
  now: number = Date.now()
): boolean {
  const key = keyFor(token);
  const checkedAt = checkedAtByToken.get(key);
  if (checkedAt === undefined) return false;
  if (now - checkedAt >= RECENT_SESSION_CHECK_TTL_MS) {
    checkedAtByToken.delete(key);
    return false;
  }
  return true;
}

export function recordSessionCheck(
  token: string,
  now: number = Date.now()
): void {
  const key = keyFor(token);
  checkedAtByToken.delete(key);
  checkedAtByToken.set(key, now);
  for (const oldest of checkedAtByToken.keys()) {
    if (checkedAtByToken.size <= MAX_TRACKED_TOKENS) break;
    checkedAtByToken.delete(oldest);
  }
}

export function resetRecentSessionChecksForTesting(): void {
  checkedAtByToken.clear();
}
