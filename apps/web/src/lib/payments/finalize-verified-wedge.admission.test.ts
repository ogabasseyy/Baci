import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

import { zeptomailSendAdmissionBudgetMs } from '@/lib/zeptomail-send-budget';
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
  });

  function authorities() {
    const finalizePayment = vi.fn().mockResolvedValue({
      kind: 'completed',
      orderNumber: 'ORD-1',
    });
    return { finalizePayment, stampResolution: vi.fn() };
  }

  it('stops without starting when the pass cannot fit the single-attempt email budget', async () => {
    const singleAttemptBudget = zeptomailSendAdmissionBudgetMs(1);
    expect(singleAttemptBudget - 1000).toBeGreaterThan(20_000);
    const deadlineMs = Date.now() + singleAttemptBudget - 1000;
    const { finalizePayment } = authorities();

    const result = await finalizeVerifiedWedge({
      candidate: { ...candidate },
      deadlineMs,
      finalizePayment,
      scheduleAfter: (task) => {
        void task();
      },
      stampResolution: vi.fn(),
      summary: summary(),
      supabase: {} as never,
      verification: { amount: 5829060, ok: true, response: {} },
    });

    expect(result).toBe('stop');
    expect(finalizePayment).not.toHaveBeenCalled();
  });

  it('admits a 90s pass share with the single-attempt cap', async () => {
    // The default four-attempt budget can never fit pass 1's 90s
    // incremental share; the capped send must.
    expect(zeptomailSendAdmissionBudgetMs()).toBeGreaterThan(90_000);
    expect(zeptomailSendAdmissionBudgetMs(1)).toBeLessThanOrEqual(90_000);
    const deadlineMs = Date.now() + 90_000;
    const { finalizePayment } = authorities();

    const result = await finalizeVerifiedWedge({
      candidate: { ...candidate },
      deadlineMs,
      finalizePayment,
      scheduleAfter: (task) => {
        void task();
      },
      stampResolution: vi.fn(),
      summary: summary(),
      supabase: {} as never,
      verification: { amount: 5829060, ok: true, response: {} },
    });

    expect(result).toBe('finalized');
    expect(finalizePayment).toHaveBeenCalledWith(
      expect.objectContaining({
        emailMaxAttemptsPerSender: 1,
        fallbackDeadlineMs: deadlineMs - 10_000,
      })
    );
  });
});
