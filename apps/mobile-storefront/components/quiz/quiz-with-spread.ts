/**
 * Spread for quiz polling and retries, so thousands of phones do not act in
 * the same instant. The random source is a parameter so tests stay
 * deterministic.
 */

export const DEFAULT_SPREAD_RATIO = 0.2;

export type RandomSource = () => number;

/** Apply +/- `ratio` jitter. `random()` of 0.5 returns exactly `ms`. */
export function withSpread(
  ms: number,
  random: RandomSource = Math.random,
  ratio = DEFAULT_SPREAD_RATIO
): number {
  const factor = 1 + (random() * 2 - 1) * ratio;
  return Math.round(ms * factor);
}
