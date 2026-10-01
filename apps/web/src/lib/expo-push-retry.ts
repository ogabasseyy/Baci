/**
 * Per-token push retry state.
 *
 * When an Expo batch is only partially accepted, the delivered tokens are
 * recorded on the attempt row so the next run resends only to the failed
 * subset instead of duplicating alerts on delivered devices.
 *
 * Split out of `expo-push.ts` (Boy Scout Rule: files over 300 lines).
 */

/** Payload key carrying tokens an earlier partial attempt already reached. */
export const DELIVERED_TOKENS_PAYLOAD_KEY = 'delivered_tokens';

/**
 * Drop tokens already reached by an earlier partial attempt, so retries
 * never send duplicates to delivered devices.
 */
export function excludeDeliveredTokens<T extends { token: string }>(
  tokens: readonly T[],
  excludeTokens?: readonly string[]
): T[] {
  if (!excludeTokens || excludeTokens.length === 0) {
    return [...tokens];
  }
  const excluded = new Set(excludeTokens);
  return tokens.filter((token) => !excluded.has(token.token));
}

/**
 * Record accepted tokens in the attempt payload for the next retry.
 * Leaves the payload untouched when nothing was delivered.
 */
export function withDeliveredTokens(
  payload: Record<string, unknown> | undefined,
  deliveredTokens: readonly string[]
): Record<string, unknown> {
  if (deliveredTokens.length === 0) {
    return { ...(payload ?? {}) };
  }
  return {
    ...(payload ?? {}),
    [DELIVERED_TOKENS_PAYLOAD_KEY]: [...deliveredTokens],
  };
}

/**
 * Read previously delivered tokens from a stored attempt payload.
 * Unknown shapes yield an empty set so the caller falls back to
 * notifying all tokens (duplicates preferred over missed alerts).
 */
export function readDeliveredTokens(payload: unknown): string[] {
  if (typeof payload !== 'object' || payload === null) {
    return [];
  }
  const tokens = (payload as Record<string, unknown>)[
    DELIVERED_TOKENS_PAYLOAD_KEY
  ];
  if (!Array.isArray(tokens)) {
    return [];
  }
  return tokens.filter((token): token is string => typeof token === 'string');
}
