import type { OwnerRequestContext } from './authorization';
import { CandidatePerformanceQualificationError } from './candidate-performance-qualification';
import { getExperienceOwnerRuntime } from './owner-runtime';
import {
  type PerformanceReader,
  readExperiencePerformance,
} from './performance-read';
/** Shared owner-web/MCP boundary; functional builds alone cannot authorize publication. */
export async function requirePublicationPerformance(
  ctx: OwnerRequestContext,
  buildId: string,
  read?: PerformanceReader
) {
  const performance = await readExperiencePerformance(
    ctx,
    buildId,
    read ?? getExperienceOwnerRuntime()?.readPerformance,
    'storefront.publish'
  );
  if (performance.qualification.status !== 'passed')
    throw new CandidatePerformanceQualificationError(
      performance.qualification.status === 'not-measured'
        ? 'missing-metrics'
        : performance.qualification.reason
    );
}
