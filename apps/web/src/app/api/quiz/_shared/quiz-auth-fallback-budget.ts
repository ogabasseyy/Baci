// Caps how many requests per server instance are passed on to Supabase Auth
// because this process could not verify their token itself (a legacy or
// unknown algorithm, an unknown key id, the JWKS unreachable, an unexpected
// issuer or audience). Every one of those is something the caller controls,
// so without a cap a flood of made-up tokens would become a flood of
// Supabase Auth calls and slow sign-in checks for real players. Tokens the
// app really holds are verified in process and never use this budget.

const FALLBACK_WINDOW_MS = 10_000;
export const FALLBACK_MAX_PER_WINDOW = 50;

let windowStartedAt = Number.NEGATIVE_INFINITY;
let usedInWindow = 0;

/** Takes one fallback slot; false when this window's budget is spent. */
export function takeAuthFallbackSlot(now: number = Date.now()): boolean {
  if (now - windowStartedAt >= FALLBACK_WINDOW_MS) {
    windowStartedAt = now;
    usedInWindow = 0;
  }
  if (usedInWindow >= FALLBACK_MAX_PER_WINDOW) return false;
  usedInWindow += 1;
  return true;
}

export function resetAuthFallbackBudgetForTesting(): void {
  windowStartedAt = Number.NEGATIVE_INFINITY;
  usedInWindow = 0;
}
