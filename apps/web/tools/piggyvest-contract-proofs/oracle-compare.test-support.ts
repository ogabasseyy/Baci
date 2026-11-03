import {
  FINDING_TRUTH,
  type TruthContext,
  VALUE_TRUTH,
} from './oracle-truth.test-support';
import type { ProofResult } from './types';

/**
 * The two properties the oracle enforces on a finished run:
 *  (1) every finding that is not `unknown` equals the sandbox's ground truth,
 *      and so does every published measurement that is not null;
 *  (2) a proof is never `observed` while one of its findings is `unknown`,
 *      unless the scenario gives no way to know it ('unobservable').
 */
export function compareRun(
  results: readonly ProofResult[],
  ctx: TruthContext
): string[] {
  const problems: string[] = [];
  for (const result of results) {
    for (const finding of result.findings) {
      const rule = FINDING_TRUTH[finding.id];
      if (!rule) {
        problems.push(`${result.proof} ${finding.id}: no ground truth defined`);
        continue;
      }
      const truth = rule(ctx);
      if (
        finding.answer !== 'unknown' &&
        truth !== 'any' &&
        finding.answer !== truth
      ) {
        problems.push(
          `${result.proof} ${finding.id}: answered ${finding.answer}, truth ${truth}`
        );
      }
      if (
        result.status === 'observed' &&
        finding.answer === 'unknown' &&
        truth !== 'unobservable'
      ) {
        problems.push(
          `${result.proof} ${finding.id}: proof is observed but the finding is unknown`
        );
      }
    }
    for (const [key, allowed] of Object.entries(VALUE_TRUTH)) {
      const value = result.values[key];
      if (value === undefined || value === null) continue;
      if (!allowed(ctx).includes(value)) {
        problems.push(
          `${result.proof} value ${key}: published ${String(value)}, truth ${allowed(ctx).join(' | ')}`
        );
      }
    }
  }
  return problems;
}
