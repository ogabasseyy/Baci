import type { ExperiencePerformanceReport } from '@/schemas/experience-performance';
import {
  type OwnerRequestContext,
  requireExperienceOwner,
} from './authorization';
import type { BuildPerformanceDependencies } from './build-performance-types';
import type { PerformanceBinding } from './performance-read';

/** Missing storage cannot turn a completed functional build into retained measurement evidence. */
export async function retainBuildPerformanceReport(
  ctx: OwnerRequestContext,
  binding: PerformanceBinding,
  performance: {
    status: 'measured' | 'failed' | 'not-measured';
    report?: ExperiencePerformanceReport;
  },
  reports: BuildPerformanceDependencies['performanceReports']
) {
  if (!performance.report)
    return performance.status === 'measured'
      ? ('not-measured' as const)
      : performance.status;
  if (!reports) return 'not-measured' as const;
  await requireExperienceOwner(ctx);
  try {
    reports.retain(binding, performance.report);
    return performance.status;
  } catch {
    return 'not-measured' as const;
  }
}
