import { formatSemanticError } from './format-semantic-error';
import type { SemanticStepOptions } from './semantic-types';

/**
 * Executes one semantic step with explicit readiness assertions on both
 * sides of the action. It never sleeps or retries implicitly.
 */
export async function runSemanticStep<T>({
  name,
  before,
  action,
  after,
}: SemanticStepOptions<T>): Promise<T> {
  try {
    await before();
  } catch (error) {
    throw new Error(
      `Semantic step "${name}" before assertion failed: ${formatSemanticError(error)}`
    );
  }

  let result: T;
  try {
    result = await action();
  } catch (error) {
    throw new Error(
      `Semantic step "${name}" action failed: ${formatSemanticError(error)}`
    );
  }

  try {
    await after(result);
  } catch (error) {
    throw new Error(
      `Semantic step "${name}" after assertion failed: ${formatSemanticError(error)}`
    );
  }

  return result;
}
