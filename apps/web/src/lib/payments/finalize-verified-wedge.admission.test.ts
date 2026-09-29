import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  finalizeOrderGatewayPayment: vi.fn(),
}));

vi.mock('./finalize-order-gateway-payment', () => ({
  finalizeOrderGatewayPayment: mocks.finalizeOrderGatewayPayment,
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

import { zeptomailSendAdmissionBudgetMs } from '@/lib/zeptomail';
import { finalizeVerifiedWedge } from './finalize-verified-wedge';

const candidate = {
  amount: '58290.60',
  created_at: '2026-07-01T00:00:00.000Z',
  currency: 'NGN',
  gateway: 'paystack',
  gateway_reference: '100004260711172450165090811595',
  id: 'txn-1',
  merchant_id: 'merchant-1',
  metadata: null,
  order_id: 'order-1',
  platform_fee: null,
  status: 'completed',
} as const;

function summary() {
  return {
    checked: 0,
    detectedUnhealable: [],
    failed: [],
    healed: [],
    reviewsFiled: [],
    skipped: [],
  };
}

describe('finalizeVerifiedWedge email budget admission', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.finalizeOrderGatewayPayment.mockResolvedValue({
      kind: 'completed',
      orderNumber: 'ORD-1',
    });
  });

  it('stops without starting when the pass cannot fit the full email retry budget', async () => {
    const fullBudget = zeptomailSendAdmissionBudgetMs();
    // The old 20s default would admit this pass; the full-loop budget
    // must not, or the finalize signal aborts mid-send and strands the
    // step delivery_uncertain instead of retrying next sweep.
    expect(fullBudget - 1000).toBeGreaterThan(20_000);
    const deadlineMs = Date.now() + fullBudget - 1000;

    const result = await finalizeVerifiedWedge({
      candidate: { ...candidate },
      deadlineMs,
      scheduleAfter: (task) => {
        void task();
      },
      summary: summary(),
      supabase: {} as never,
      verification: { amount: 5829060, ok: true, response: {} },
    });

    expect(result).toBe('stop');
    expect(mocks.finalizeOrderGatewayPayment).not.toHaveBeenCalled();
  });

  it('bounds the sender fallback to the pass deadline when budget fits', async () => {
    const fullBudget = zeptomailSendAdmissionBudgetMs();
    const deadlineMs = Date.now() + fullBudget + 120_000;

    const result = await finalizeVerifiedWedge({
      candidate: { ...candidate },
      deadlineMs,
      scheduleAfter: (task) => {
        void task();
      },
      summary: summary(),
      supabase: {} as never,
      verification: { amount: 5829060, ok: true, response: {} },
    });

    expect(result).toBe('finalized');
    expect(mocks.finalizeOrderGatewayPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        fallbackDeadlineMs: deadlineMs - 10_000,
      })
    );
  });
});
