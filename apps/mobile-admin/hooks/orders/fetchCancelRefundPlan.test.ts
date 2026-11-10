import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ result: vi.fn() }));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({ eq: () => ({ in: mocks.result }) }),
      }),
    }),
  },
}));

import { fetchCancelRefundPlan } from './fetchCancelRefundPlan';

const args = {
  merchantId: 'm1',
  orderId: 'o1',
  paymentStatus: 'paid',
  total: 5000,
};

describe('fetchCancelRefundPlan', () => {
  beforeEach(() => vi.clearAllMocks());

  it('plans the outstanding Paystack leg as automatically refundable', async () => {
    mocks.result.mockResolvedValue({
      data: [
        {
          amount: 5000,
          currency: 'NGN',
          gateway: 'paystack',
          gateway_reference: 'ref',
          id: 'leg-1',
          status: 'completed',
          transaction_type: 'payment',
        },
      ],
      error: null,
    });
    await expect(fetchCancelRefundPlan(args)).resolves.toEqual({
      amount: 5000,
      automaticSupported: true,
    });
  });

  it('marks a Korapay leg as not automatically refundable', async () => {
    mocks.result.mockResolvedValue({
      data: [
        {
          amount: 5000,
          currency: 'NGN',
          gateway: 'korapay',
          gateway_reference: 'ref',
          id: 'leg-1',
          status: 'completed',
          transaction_type: 'payment',
        },
      ],
      error: null,
    });
    await expect(fetchCancelRefundPlan(args)).resolves.toMatchObject({
      automaticSupported: false,
    });
  });

  it('returns undefined when the ledger cannot be read', async () => {
    mocks.result.mockResolvedValue({ data: null, error: { message: 'x' } });
    await expect(fetchCancelRefundPlan(args)).resolves.toBeUndefined();
  });
});
