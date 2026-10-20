// Refund-family pending replay rows (order-refund management plus the
// Paystack cancellation workers), aggregated out of
// `supabase-history-replay-sources.ts` to keep that manifest under the
// 300-line modularity limit. The manifest joins and filename-sorts
// every block, so grouping is transparent to the replay order.
import { ORDER_REFUND_PENDING_REPLAY_SOURCE_ROWS } from './supabase-history-replay-order-refund-pending-sources';
import { PAYSTACK_CANCELLATION_COMPLETION_PENDING_REPLAY_SOURCE_ROWS } from './supabase-history-replay-paystack-cancellation-completion-pending-sources';
import { PAYSTACK_CANCELLATION_PENDING_REPLAY_SOURCE_ROWS } from './supabase-history-replay-paystack-cancellation-pending-sources';

export const REFUND_PENDING_REPLAY_SOURCE_ROWS = [
  ORDER_REFUND_PENDING_REPLAY_SOURCE_ROWS,
  PAYSTACK_CANCELLATION_PENDING_REPLAY_SOURCE_ROWS,
  PAYSTACK_CANCELLATION_COMPLETION_PENDING_REPLAY_SOURCE_ROWS,
].join('\n');
