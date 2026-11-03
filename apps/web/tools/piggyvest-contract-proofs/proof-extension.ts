import { ProofBuilder } from './proof-builder';
import type { ProofContext } from './proof-context';
import { HarnessRefusal } from './safety-guards';
import type { ProofResult, ProofStatus, Scalar } from './types';

/**
 * Adds a step to an existing proof without rewriting it. The base proof runs
 * first; the added step then fills a builder for the SAME proof, and the two
 * results are merged into one section of the evidence. The merged status is
 * never better than either part, so an unanswered added question keeps the
 * proof inconclusive.
 */

export type ProofRunner = (ctx: ProofContext) => Promise<ProofResult>;
export type ProofExtension = (
  ctx: ProofContext,
  b: ProofBuilder
) => Promise<void>;

export function mergeStatus(a: ProofStatus, b: ProofStatus): ProofStatus {
  if (a === 'failed' || b === 'failed') return 'failed';
  if (a === 'skipped' && b === 'skipped') return 'skipped';
  if (a === 'observed' && b === 'observed') return 'observed';
  return 'inconclusive';
}

export function mergeResults(
  base: ProofResult,
  extra: ProofResult
): ProofResult {
  const status = mergeStatus(base.status, extra.status);
  const reasons = [base, extra]
    .filter((part) => part.status !== 'observed' && part.reason)
    .map((part) => part.reason);
  const values: Record<string, Scalar> = { ...base.values };
  for (const [key, value] of Object.entries(extra.values)) {
    values[key in values ? `${key}_ext` : key] = value;
  }
  return {
    proof: base.proof,
    title: base.title,
    status,
    ...(status !== 'observed' && reasons.length > 0
      ? { reason: reasons.join('; ') }
      : {}),
    findings: [...base.findings, ...extra.findings],
    shapes: [...base.shapes, ...extra.shapes],
    values,
    notes: [...base.notes, ...extra.notes],
  };
}

export function withExtension(
  base: ProofRunner,
  extension: ProofExtension
): ProofRunner {
  return async (ctx) => {
    const first = await base(ctx);
    const b = new ProofBuilder(first.proof, first.title);
    try {
      await extension(ctx, b);
    } catch (error) {
      if (error instanceof HarnessRefusal) throw error;
      b.fail(
        `an added step stopped on an unexpected ${error instanceof Error ? error.name : 'error'}; details withheld`
      );
    }
    return mergeResults(first, b.build(ctx));
  };
}
