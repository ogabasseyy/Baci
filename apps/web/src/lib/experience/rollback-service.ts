import type { OwnerRequestContext } from './authorization';
import { requestExperiencePublication } from './publication-service';
/** Intent only: no pointer mutation or order/payment reversal. */
export const requestExperienceRollback = (
  ctx: OwnerRequestContext,
  input: unknown
) => requestExperiencePublication(ctx, input, 'rollback');
