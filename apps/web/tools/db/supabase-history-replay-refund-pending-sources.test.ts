import { describe, expect, it } from 'vitest';
import { ORDER_REFUND_PENDING_REPLAY_SOURCE_ROWS } from './supabase-history-replay-order-refund-pending-sources';
import { PAYSTACK_CANCELLATION_COMPLETION_PENDING_REPLAY_SOURCE_ROWS } from './supabase-history-replay-paystack-cancellation-completion-pending-sources';
import { PAYSTACK_CANCELLATION_PENDING_REPLAY_SOURCE_ROWS } from './supabase-history-replay-paystack-cancellation-pending-sources';
import { REFUND_PENDING_REPLAY_SOURCE_ROWS } from './supabase-history-replay-refund-pending-sources';

describe('refund pending replay sources', () => {
  it('joins the refund-family blocks for the manifest', () => {
    expect(REFUND_PENDING_REPLAY_SOURCE_ROWS).toBe(
      [
        ORDER_REFUND_PENDING_REPLAY_SOURCE_ROWS,
        PAYSTACK_CANCELLATION_PENDING_REPLAY_SOURCE_ROWS,
        PAYSTACK_CANCELLATION_COMPLETION_PENDING_REPLAY_SOURCE_ROWS,
      ].join('\n')
    );
  });

  it('carries rows from every aggregated source file', () => {
    for (const block of [
      ORDER_REFUND_PENDING_REPLAY_SOURCE_ROWS,
      PAYSTACK_CANCELLATION_PENDING_REPLAY_SOURCE_ROWS,
      PAYSTACK_CANCELLATION_COMPLETION_PENDING_REPLAY_SOURCE_ROWS,
    ]) {
      const firstRow = block.trim().split('\n')[0];
      expect(REFUND_PENDING_REPLAY_SOURCE_ROWS).toContain(firstRow);
    }
  });
});
