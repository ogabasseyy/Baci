import type { RandomSource } from './quiz-with-spread';

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
