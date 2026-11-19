import type { OwnerRequestContext } from './authorization';
import type { PerformanceReader } from './performance-read';
import { requestExperiencePublication } from './publication-service';
/** Intent only: no pointer mutation or order/payment reversal. */
export const requestExperienceRollback = (
  ctx: OwnerRequestContext,
  input: unknown,
  readPerformance?: PerformanceReader
) => requestExperiencePublication(ctx, input, 'rollback', readPerformance);
