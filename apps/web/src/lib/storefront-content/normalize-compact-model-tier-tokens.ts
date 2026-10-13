const COMPACT_MODEL_TIER_PATTERN =
  /^([a-z]+\d[a-z0-9]*)(fe|se|lite|max|mini|neo|plus|power|prime|pro|ultra)$/u;

/** Splits compact model tiers so catalog names and guide titles share tokens. */
export function normalizeCompactModelTierTokens(tokens: string[]) {
  return tokens.flatMap((token) => {
    const match = token.match(COMPACT_MODEL_TIER_PATTERN);
    return match ? [match[1] ?? token, match[2] ?? ''] : [token];
  });
}
