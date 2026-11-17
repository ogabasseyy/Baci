import { type RandomSource, withSpread } from './quiz-with-spread';

interface BackoffInput {
  baseMs: number;
  /** Consecutive failures so far; 0 or less means no failure. */
  failures: number;
  /**
   * Longest delay before the spread is applied. The spread comes after, so
   * the returned delay can be up to 20% above this: a hard ceiling would put
   * every capped phone back on the same instant.
   */
  capMs: number;
  /** Never retry sooner than this (applied after spread). */
  floorMs?: number;
  random?: RandomSource;
}

/**
 * Exponential backoff (x2 per consecutive failure) capped at `capMs`, then
 * +/- 20% spread. With no failures this is the base interval with spread.
 */
export function backoffDelay({
  baseMs,
  failures,
  capMs,
  floorMs = 0,
  random = Math.random,
}: BackoffInput): number {
  const exponent = Math.max(failures - 1, 0);
  const raw = Math.min(baseMs * 2 ** Math.min(exponent, 30), capMs);
  const spread = withSpread(failures > 0 ? raw : baseMs, random);
  return Math.max(spread, floorMs);
}
