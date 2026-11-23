import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildRequest,
  CRON_SECRET,
  GET,
  mockSweepResult,
  mocks,
  resetReconciliationRouteMocks,
} from './route.test-support';

beforeEach(resetReconciliationRouteMocks);

describe('paid bank card offer reconciliation', () => {
  it('shares the invocation budget with a bounded paid bank-offer pass', async () => {
    mockSweepResult({ checked: 0 });
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    try {
      const response = await GET(buildRequest(`Bearer ${CRON_SECRET}`));

      expect(response.status).toBe(200);
      expect(mocks.reconcileAbandonedPaystackAttempts).toHaveBeenCalledWith(
        expect.objectContaining({ deadlineMs: 1_090_000 })
      );
      expect(mocks.reconcileWedgedGatewayOrders).toHaveBeenCalledWith(
        expect.objectContaining({ deadlineMs: 1_160_000 })
      );
      expect(mocks.recheckPaidBankCardOfferCaptures).toHaveBeenCalledWith(
        expect.objectContaining({
          deadlineMs: 1_020_000,
          finalizePayment: mocks.finalizeOrderGatewayPayment,
        })
      );
      expect(mocks.drainFailedPaidOrderSideEffects).toHaveBeenCalledWith(
        expect.objectContaining({ deadlineMs: 1_270_000 })
      );
    } finally {
      now.mockRestore();
    }
  });

  it('reports when earlier passes consume the paid bank-offer recheck budget', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    mocks.reconcileWedgedGatewayOrders.mockImplementation(async (input) => {
      await input.beforeSweep({
        finalizePayment: mocks.finalizeOrderGatewayPayment,
        fileWedgeReview: mocks.fileWedgeReview,
      });
      now.mockReturnValue(1_180_001);
      return { checked: 0 };
    });

    try {
      const response = await GET(buildRequest(`Bearer ${CRON_SECRET}`));
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        bankOfferRecheckSkipped: true,
      });
      expect(mocks.recheckPaidBankCardOfferCaptures).not.toHaveBeenCalled();
      expect(mocks.logger.warn).toHaveBeenCalledWith({
        message: expect.stringContaining('invocation budget exhausted'),
      });
    } finally {
      now.mockRestore();
    }
  });

  it.each([
    { failed: 0, retrying: 1 },
    { failed: 1, retrying: 0 },
  ])('distinguishes deferred checks from recheck failures (%j)', async (counts) => {
    const bankOfferRecheck = {
      checked: 1,
      ...counts,
      reversed: 0,
    };
    mocks.recheckPaidBankCardOfferCaptures.mockResolvedValue(bankOfferRecheck);

    const response = await GET(buildRequest(`Bearer ${CRON_SECRET}`));

    expect(response.status).toBe(counts.failed ? 503 : 200);
    expect(await response.json()).toMatchObject({ bankOfferRecheck });
  });

  it('retains the recheck error for operations on a failed pass', async () => {
    const error = new Error('recheck database unavailable');
    mocks.recheckPaidBankCardOfferCaptures.mockRejectedValueOnce(error);

    const response = await GET(buildRequest(`Bearer ${CRON_SECRET}`));

    expect(response.status).toBe(503);
    expect(mocks.logger.warn).toHaveBeenCalledWith({
      error,
      message: 'Paid bank card offer recheck pass failed',
    });
  });
});
