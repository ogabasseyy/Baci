import { describe, expectTypeOf, it } from 'vitest';
import type { RefundSummary } from './refund-summary';

describe('RefundSummary.cancellationRefundMode', () => {
  it('accepts the persisted modes, unknown, null and undefined only', () => {
    expectTypeOf<RefundSummary['cancellationRefundMode']>().toEqualTypeOf<
      'automatic' | 'manual' | 'unknown' | null | undefined
    >();
    const accepted: RefundSummary['cancellationRefundMode'][] = [
      'automatic',
      'manual',
      'unknown',
      null,
      undefined,
    ];
    expectTypeOf(accepted).not.toBeAny();
    // @ts-expect-error other strings are not a valid mode
    const rejected: RefundSummary['cancellationRefundMode'] = 'other';
    expectTypeOf(rejected).not.toBeAny();
  });
});
