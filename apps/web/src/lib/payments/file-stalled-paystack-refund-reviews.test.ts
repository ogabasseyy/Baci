import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fileStalledPaystackRefundReviews } from './file-stalled-paystack-refund-reviews';

const mocks = vi.hoisted(() => ({
  fileActiveOrderPaystackRefundCandidateReviews: vi.fn(),
  fileCancelledPaystackRefundCandidateReviews: vi.fn(),
  fileUnclaimedPaystackRefundCandidateReview: vi.fn(),
  loggerInfo: vi.fn(),
}));

vi.mock('./file-cancelled-paystack-refund-candidate-reviews', () => ({
  fileCancelledPaystackRefundCandidateReviews:
    mocks.fileCancelledPaystackRefundCandidateReviews,
}));
vi.mock('./file-provider-refund-outside-cancellation-review', () => ({
  fileActiveOrderPaystackRefundCandidateReviews:
    mocks.fileActiveOrderPaystackRefundCandidateReviews,
}));
vi.mock('./file-invalid-paystack-refund-evidence-review', () => ({
  fileUnclaimedPaystackRefundCandidateReview:
    mocks.fileUnclaimedPaystackRefundCandidateReview,
}));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: mocks.loggerInfo, warn: vi.fn() },
}));

function stalledChain(limit: ReturnType<typeof vi.fn>) {
  const chain: {
    eq: ReturnType<typeof vi.fn>;
    gt: ReturnType<typeof vi.fn>;
    ilike: ReturnType<typeof vi.fn>;
    in: ReturnType<typeof vi.fn>;
    limit: ReturnType<typeof vi.fn>;
    order: ReturnType<typeof vi.fn>;
  } = {
    eq: vi.fn(),
    gt: vi.fn(),
    ilike: vi.fn(),
    in: vi.fn(),
    limit,
    order: vi.fn(),
  };
  chain.eq.mockReturnValue(chain);
  chain.gt.mockReturnValue(chain);
  chain.ilike.mockReturnValue(chain);
  chain.in.mockReturnValue(chain);
  chain.order.mockReturnValue(chain);
  return chain;
}

function database(pages: unknown[][]) {
  const limit = vi.fn();
  for (const page of pages) {
    limit.mockResolvedValueOnce({ data: page, error: null });
  }
  const chain = stalledChain(limit);
  const select = vi.fn().mockReturnValue(chain);
  const from = vi.fn().mockReturnValue({ select });
  return {
    chain,
    from,
    supabase: { from } as unknown as SupabaseClient,
  };
}

const evidence = {
  providerPaymentTransactionId: 555,
  providerRefundId: 202,
  providerRefundStatus: 'failed',
  reference: 'PSK-1',
};
const refund = { amount: 10000, currency: 'NGN', status: 'processed' };
const stalled = [
  {
    amount: 100,
    gateway: 'paystack',
    gateway_reference: 'PSK-1',
    id: 'pay-stalled',
    merchant_id: 'merchant-1',
    order_id: 'order-1',
  },
];
const reason =
  'Paystack refund 202 matches a non-completed local payment for reference PSK-1';

describe('fileStalledPaystackRefundReviews', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fileCancelledPaystackRefundCandidateReviews.mockResolvedValue([
      'pay-stalled',
    ]);
    mocks.fileActiveOrderPaystackRefundCandidateReviews.mockResolvedValue([]);
    mocks.fileUnclaimedPaystackRefundCandidateReview.mockResolvedValue(
      undefined
    );
  });

  it('files both queues when stalled payments match', async () => {
    const { chain, supabase } = database([stalled]);

    const filed = await fileStalledPaystackRefundReviews(supabase, {
      evidence,
      gatewayReference: 'PSK-1',
      refund,
      refundId: 202,
    });

    expect(chain.in).toHaveBeenCalledWith('status', [
      'pending',
      'processing',
      'failed',
    ]);
    expect(
      mocks.fileCancelledPaystackRefundCandidateReviews
    ).toHaveBeenCalledWith(supabase, stalled, evidence, reason);
    expect(
      mocks.fileActiveOrderPaystackRefundCandidateReviews
    ).toHaveBeenCalledWith(supabase, stalled, evidence, reason, refund);
    expect(
      mocks.fileUnclaimedPaystackRefundCandidateReview
    ).toHaveBeenCalledWith(supabase, {
      candidates: stalled,
      evidence,
      filed: [['pay-stalled'], []],
      reason,
      reference: 'PSK-1',
      refundId: 202,
    });
    expect(mocks.loggerInfo).toHaveBeenCalledWith(
      expect.objectContaining({ refundId: 202 })
    );
    expect(filed).toBe(stalled.length);
  });

  it('returns without filing when nothing matches', async () => {
    const { supabase } = database([[]]);

    const filed = await fileStalledPaystackRefundReviews(supabase, {
      evidence,
      gatewayReference: 'PSK-1',
      refund,
      refundId: 202,
    });

    expect(
      mocks.fileCancelledPaystackRefundCandidateReviews
    ).not.toHaveBeenCalled();
    expect(
      mocks.fileActiveOrderPaystackRefundCandidateReviews
    ).not.toHaveBeenCalled();
    expect(mocks.loggerInfo).toHaveBeenCalledWith(
      expect.objectContaining({ refundId: 202 })
    );
    expect(filed).toBe(0);
  });

  it.each([
    'Paystack',
    ' paystack ',
  ])('files a legacy stalled payment stored as %s', async (gateway) => {
    const rows = [{ ...stalled[0], gateway }];
    const { chain, supabase } = database([rows]);

    const filed = await fileStalledPaystackRefundReviews(supabase, {
      evidence,
      gatewayReference: 'PSK-1',
      refund,
      refundId: 202,
    });

    expect(chain.ilike).toHaveBeenCalledWith('gateway', '%paystack%');
    expect(
      mocks.fileCancelledPaystackRefundCandidateReviews
    ).toHaveBeenCalledWith(supabase, rows, evidence, reason);
    expect(filed).toBe(1);
  });

  it('skips a foreign gateway the loose prefilter admitted', async () => {
    const { supabase } = database([
      [{ ...stalled[0], gateway: 'korapay', id: 'pay-foreign' }],
    ]);

    const filed = await fileStalledPaystackRefundReviews(supabase, {
      evidence,
      gatewayReference: 'PSK-1',
      refund,
      refundId: 202,
    });

    expect(
      mocks.fileCancelledPaystackRefundCandidateReviews
    ).not.toHaveBeenCalled();
    expect(
      mocks.fileActiveOrderPaystackRefundCandidateReviews
    ).not.toHaveBeenCalled();
    expect(filed).toBe(0);
  });

  it('paginates full pages before filing', async () => {
    const first = Array.from({ length: 10 }, (_, index) => ({
      ...stalled[0],
      id: `pay-${index}`,
    }));
    const second = [{ ...stalled[0], id: 'pay-10' }];
    const { chain, supabase } = database([first, second]);

    await fileStalledPaystackRefundReviews(supabase, {
      evidence,
      gatewayReference: 'PSK-1',
      refund,
      refundId: 202,
    });

    expect(chain.limit).toHaveBeenCalledWith(10);
    expect(chain.gt).toHaveBeenCalledWith('id', 'pay-9');
    expect(
      mocks.fileCancelledPaystackRefundCandidateReviews
    ).toHaveBeenCalledWith(supabase, [...first, ...second], evidence, reason);
  });

  it('throws when the stalled lookup fails', async () => {
    const limit = vi.fn().mockResolvedValue({
      data: null,
      error: new Error('db down'),
    });
    const select = vi.fn().mockReturnValue(stalledChain(limit));
    const from = vi.fn().mockReturnValue({ select });
    const supabase = { from } as unknown as SupabaseClient;

    await expect(
      fileStalledPaystackRefundReviews(supabase, {
        evidence,
        gatewayReference: 'PSK-1',
        refund,
        refundId: 202,
      })
    ).rejects.toThrow('refund_event_payment_lookup_failed');
  });
});
