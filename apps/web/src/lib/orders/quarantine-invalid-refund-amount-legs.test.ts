import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  quarantineRefund: vi.fn(),
}));

vi.mock('@/lib/orders/quarantine-order-cancellation-refund', () => ({
  quarantineRefund: mocks.quarantineRefund,
}));

import { quarantineInvalidRefundAmountLegs } from './quarantine-invalid-refund-amount-legs';

describe('quarantineInvalidRefundAmountLegs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const order = { id: 'order-1' } as never;
  const supabase = {} as never;

  it('quarantines only the non-finite legs', async () => {
    const valid = { amount: 100, id: 'payment-1' };
    const corrupt = { amount: 'NaN', id: 'payment-2' };

    await quarantineInvalidRefundAmountLegs({
      order,
      supabase,
      transactions: [valid, corrupt] as never,
    });

    expect(mocks.quarantineRefund).toHaveBeenCalledWith(
      expect.objectContaining({
        order,
        preflight: true,
        reason: expect.stringContaining('invalid amount'),
        transactions: [corrupt],
      })
    );
  });

  it.each([
    [100],
    [0],
    [-50],
  ])('does nothing when every leg amount is finite (%s)', async (amount) => {
    await quarantineInvalidRefundAmountLegs({
      order,
      supabase,
      transactions: [{ amount, id: 'payment-1' }] as never,
    });

    expect(mocks.quarantineRefund).not.toHaveBeenCalled();
  });
});
