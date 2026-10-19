// Cancellation fencing for PATCH /api/orders/[id] updates.
//
// Terminal states are terminal in both directions: the predicates
// ride on the UPDATE itself so a cancellation committing after the
// route's read cannot be resurrected by the write — zero rows match
// instead of a stale-status update landing. Extracted from the
// oversized route alongside evaluate-order-cancelled-transition.
import { CANCELLED_STATUS_SPELLINGS } from './evaluate-order-cancelled-transition';

interface FenceableUpdateQuery {
  neq: (column: string, value: string) => FenceableUpdateQuery;
}

/** Appends both cancellation spellings on both status axes. */
export function appendCancelledStatusFences<T extends FenceableUpdateQuery>(
  query: T
): T {
  let fenced: FenceableUpdateQuery = query;
  for (const [column, spelling] of CANCELLED_STATUS_SPELLINGS) {
    fenced = fenced.neq(column, spelling);
  }
  return fenced as T;
}
