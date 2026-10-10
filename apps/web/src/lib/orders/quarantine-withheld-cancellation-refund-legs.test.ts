import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  order,
  paystackPayment,
} from './execute-order-cancellation-side-effect.test-support';
import { quarantineWithheldCancellationRefundLegs } from './quarantine-withheld-cancellation-refund-legs';
import { DeliveryUncertainError } from './run-order-cancellation-side-effect';

function supabase() {
  const insert = vi.fn().mockResolvedValue({ error: null });
  return {
    from: vi.fn().mockReturnValue({ insert }),
    insert,
    rpc: vi.fn(),
  };
}

describe('quarantineWithheldCancellationRefundLegs', () => {
  beforeEach(() => vi.clearAllMocks());

  it('files nothing when every leg initiated', async () => {
    const client = supabase();
    await expect(
      quarantineWithheldCancellationRefundLegs({
        auditBlockedTransactions: [],
        mismatchedTransactions: [],
        order: order as never,
        supabase: client as never,
      })
    ).resolves.toBeUndefined();
    expect(client.insert).not.toHaveBeenCalled();
  });

  it('files audit-blocked legs before mismatched ones', async () => {
    const client = supabase();
    await expect(
      quarantineWithheldCancellationRefundLegs({
        auditBlockedTransactions: [paystackPayment as never],
        mismatchedTransactions: [
          { ...paystackPayment, id: 'payment-2' } as never,
        ],
        order: order as never,
        supabase: client as never,
      })
    ).rejects.toBeInstanceOf(DeliveryUncertainError);
    expect(client.insert).toHaveBeenCalledTimes(1);
    expect(client.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        issue_type: 'order_cancellation_refund_requires_review',
        metadata: expect.objectContaining({ audit_blocked_leg_count: 1 }),
      })
    );
  });

  it('files mismatched legs when nothing is audit-blocked', async () => {
    const client = supabase();
    await expect(
      quarantineWithheldCancellationRefundLegs({
        auditBlockedTransactions: [],
        mismatchedTransactions: [
          { ...paystackPayment, id: 'payment-2' } as never,
        ],
        order: order as never,
        supabase: client as never,
      })
    ).rejects.toBeInstanceOf(DeliveryUncertainError);
    expect(client.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ mismatched_leg_count: 1 }),
      })
    );
  });
});
