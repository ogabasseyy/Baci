/**
 * Pure timing helpers that spread quiz polling and retries so thousands of
 * phones do not act in the same instant. The random source is a parameter so
 * tests stay deterministic.
 */

export const DEFAULT_SPREAD_RATIO = 0.2;

type RandomSource = () => number;

/** Apply +/- `ratio` jitter. `random()` of 0.5 returns exactly `ms`. */
export function withSpread(
  ms: number,
  random: RandomSource = Math.random,
  ratio = DEFAULT_SPREAD_RATIO
): number {
  const factor = 1 + (random() * 2 - 1) * ratio;
  return Math.round(ms * factor);
}

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

/**
 * Uniform random integer delay in [0, maxMs]. The clamp keeps the result in
 * range for a random source that returns exactly 1.
 */
export function randomDelay(
  maxMs: number,
  random: RandomSource = Math.random
): number {
  return Math.min(Math.floor(random() * (maxMs + 1)), maxMs);
}

/** True for a rate-limited (429) or overloaded (503) response error. */
export function isOverloadError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { status } = error as { status?: unknown };
  return status === 429 || status === 503;
}

const WAITING_ROOM_RETRY_BASE_MS = 1_000;
const WAITING_ROOM_RETRY_CAP_MS = 5_000;

/**
 * Waiting-room refresh retry: 1, 2, 4 then 5 s (with spread), and never
 * sooner than 5 s once the server has said it is rate limiting or overloaded.
 */
export function waitingRoomRetryDelay(
  failures: number,
  error: unknown,
  random: RandomSource = Math.random
): number {
  return backoffDelay({
    baseMs: WAITING_ROOM_RETRY_BASE_MS,
    failures,
    capMs: WAITING_ROOM_RETRY_CAP_MS,
    floorMs: isOverloadError(error) ? WAITING_ROOM_RETRY_CAP_MS : 0,
    random,
  });
}
