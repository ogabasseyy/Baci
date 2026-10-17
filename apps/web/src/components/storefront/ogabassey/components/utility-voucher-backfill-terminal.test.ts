import { describe, expect, it } from 'vitest';
import { isTerminalBackfill } from './utility-voucher-backfill-terminal';

describe('isTerminalBackfill', () => {
  it('settles skipped failures without a refund confirmation', () => {
    // Codex R110 P2: nothing is coming (no credit runs), so
    // pollers stop — but refundConfirmed stays false for the copy.
    expect(
      isTerminalBackfill(
        {
          failed: true,
          pin: null,
          refundConfirmed: false,
          refundSkipped: true,
          refundedAmount: null,
          successful: false,
        },
        false
      )
    ).toBe(true);
    expect(
      isTerminalBackfill(
        {
          failed: true,
          pin: null,
          refundConfirmed: false,
          refundSkipped: false,
          refundedAmount: null,
          successful: false,
        },
        false
      )
    ).toBe(false);
  });
})