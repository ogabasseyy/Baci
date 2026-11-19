/**
 * How long the setup sheet waits before each automatic account-number check.
 * PiggyVest can create the wallet in seconds but take over a minute to issue
 * the bank account number, so the sheet checks quickly at first and then every
 * 15 seconds, for about five minutes in all, before offering a manual check.
 */
const FIRST_DELAYS_MS = [3000, 5000, 8000] as const;
const STEADY_DELAY_MS = 15_000;
const STEADY_CHECKS = 19;

/** Automatic checks run before the sheet falls back to "Check now". */
export const AUTO_CHECK_LIMIT = FIRST_DELAYS_MS.length + STEADY_CHECKS;

/** The wait before automatic check number `done + 1`, or null once used up. */
export function autoCheckDelayMs(done: number): number | null {
  if (!Number.isInteger(done) || done < 0 || done >= AUTO_CHECK_LIMIT) {
    return null;
  }
  return FIRST_DELAYS_MS[done] ?? STEADY_DELAY_MS;
}
