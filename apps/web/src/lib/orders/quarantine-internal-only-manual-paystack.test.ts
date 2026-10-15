import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./quarantine-order-cancellation-refund', () => ({
  quarantineRefund: vi.fn(),
}));

import { quarantineInternalOnlyManualPaystack } from './quarantine-internal-only-manual-paystack';
import { quarantineRefund } from './quarantine-order-cancellation-refund';

const legs = [
  { id: 'leg-cash', amount: 100, currency: 'NGN', gateway: 'cash' },
] as never;
const input = {
  allLegs: legs,
  order: { id: 'order-1', merchant_id: 'm-1', currency: 'NGN' },
  refundRows: [],
  supabase: {},
} as unknown as Parameters<typeof quarantineInternalOnlyManualPaystack>[0];

describe('quarantineInternalOnlyManualPaystack', () => {
  beforeEach(() => vi.clearAllMocks());
  it('files the internal-only review with the unverified leg ids', async () => {
    await quarantineInternalOnlyManualPaystack({
      ...input,
      refundRows: [
        {
          gateway: 'manual',
          metadata: {
            method: 'paystack',
            payment_transaction_id: 'leg-cash',
          },
        },
        {
          gateway: 'manual',
          metadata: {
            method: 'paystack',
            payment_transaction_id: 'leg-elsewhere',
          },
        },
      ],
    });
    expect(vi.mocked(quarantineRefund)).toHaveBeenCalledWith(
      expect.objectContaining({
        preflight: true,
        transactions: legs,
        metadata: expect.objectContaining({
          unverified_manual_paystack_leg_ids: ['leg-cash'],
        }),
        reason: expect.stringContaining('no external leg exists'),
      })
    );
  });
  it('returns quietly when no unverified manual Paystack claim exists', async () => {
    await expect(
      quarantineInternalOnlyManualPaystack(input)
    ).resolves.toBeUndefined();
    expect(vi.mocked(quarantineRefund)).not.toHaveBeenCalled();
  });
});
