import { formatSemanticError } from './format-semantic-error';
import type { StabilityGateOptions } from './semantic-types';

/**
 * Runs a deterministic flow repeatedly, failing on the first unstable run.
 * The flow owns its reset and semantic waits; no arbitrary delay is hidden
 * here. The default of three complete runs is the mobile-admin stability
 * contract.
 */
export async function runWithStabilityGate<T>(
  run: (iteration: number) => T | Promise<T>,
  options: StabilityGateOptions = {}
): Promise<readonly T[]> {
  const repeats = options.repeats ?? 3;
  if (!Number.isInteger(repeats) || repeats < 2) {
    throw new Error(
      'Stability gate repeats must be an integer greater than one'
    );
  }

  const results: T[] = [];
  for (let iteration = 1; iteration <= repeats; iteration += 1) {
    try {
      results.push(await run(iteration));
    } catch (error) {
      throw new Error(
        `Stability gate failed on iteration ${iteration}: ${formatSemanticError(error)}`
      );
    }
  }

  return results;
}
