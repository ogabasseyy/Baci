import { beforeEach, describe, expect, it } from 'vitest';
import { cronHarness } from './route.test-support';

const { createCronRequest, mocks, resetCronMocks, runCron, stuckOrder } =
  cronHarness;

describe('GET /api/cron/alert-stuck-bnpl', () => {
  beforeEach(resetCronMocks);

  it.each([
    ['paystack', 'active-session', false],
    ['credit_direct', 'old-txn', false],
    ['credit_direct', 'active-session', true],
    [' Credit_Direct ', 'active-session', true],
    [null, 'active-session', false],
  ])('checks progressed %s evidence for the active attempt (%s)', async (gateway, reference, matches) => {
    mocks.limit.mockResolvedValue({
      data: [
        stuckOrder({
          id: 'order-1',
          payment_method: ' Credit_Direct ',
          notes: JSON.stringify({
            creditDirectSessionId: 'active-session',
            creditDirectSupersededReferences: ['old-txn'],
          }),
        }),
      ],
      error: null,
    });
    mocks.transactionsIn.mockResolvedValue({
      data: [
        {
          order_id: 'order-1',
          gateway,
          gateway_reference: reference,
          status: 'processing',
        },
      ],
      error: null,
    });
    const response = await runCron(createCronRequest());
    expect(response.status).toBe(200);
    expect(mocks.notifyMerchant).toHaveBeenCalledTimes(matches ? 1 : 0);
    if (gateway === null) {
      expect(mocks.loggerWarn).toHaveBeenCalledWith(
        expect.objectContaining({ unknownGatewayCount: 1 })
      );
    }
  });

  it('keeps an unbound legacy completion in operator review without alerting', async () => {
    mocks.limit.mockResolvedValue({
      data: [
        stuckOrder({
          id: 'legacy-order',
          payment_status: 'unpaid',
          notes: '{"creditDirectClientCompletedAt":"2026-07-01T00:01:00.000Z"}',
        }),
      ],
      error: null,
    });

    const response = await runCron(createCronRequest());
    expect(await response.json()).toMatchObject({
      stuckOrders: 0,
      alertOrders: 0,
      reviewOnlyOrders: 1,
    });
    expect(mocks.reviewInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        order_id: 'legacy-order',
        paystack_ref: null,
      })
    );
    expect(mocks.notifyMerchant).not.toHaveBeenCalled();
  });

  it('keeps session-only SDK-success evidence in the pending-order scan', async () => {
    mocks.limit.mockResolvedValue({
      data: [
        stuckOrder({
          id: 'order-session-only',
          payment_status: 'pending',
          notes: JSON.stringify({
            creditDirectSessionId: 'session-1',
            creditDirectClientCompletedSessionId: 'session-1',
            creditDirectClientCompletedAt: '2026-07-01T00:01:00.000Z',
          }),
        }),
      ],
      error: null,
    });

    const response = await runCron(createCronRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.stuckOrders).toBe(1);
    expect(mocks.reviewInsert).toHaveBeenCalledWith(
      expect.objectContaining({ order_id: 'order-session-only' })
    );
    expect(mocks.notifyMerchant).toHaveBeenCalledTimes(1);
    expect(mocks.transactionsIn).not.toHaveBeenCalled();
  });

  it('ignores still-pending transaction rows so initialize-flow abandoners stay excluded', async () => {
    mocks.limit.mockResolvedValue({
      data: [
        stuckOrder({
          id: 'order-1',
          payment_status: 'unpaid',
          payment_method: 'credpal',
          notes: null,
        }),
      ],
      error: null,
    });
    mocks.transactionsIn.mockResolvedValue({
      data: [{ order_id: 'order-1', gateway: 'credpal', status: 'pending' }],
      error: null,
    });

    const response = await runCron(createCronRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.stuckOrders).toBe(0);
    expect(mocks.notifyMerchant).not.toHaveBeenCalled();
    expect(mocks.loggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        message:
          'Stuck-BNPL scan dropped pending/unpaid BNPL orders without provider evidence (possible stuck CredPal)',
        droppedCount: 1,
        orderIds: ['order-1'],
      })
    );
  });

  it('skips pending orders conservatively when the transaction-evidence check fails', async () => {
    mocks.limit.mockResolvedValue({
      data: [
        stuckOrder({
          id: 'order-1',
          payment_status: 'unpaid',
          payment_method: 'credpal',
          notes: null,
        }),
      ],
      error: null,
    });
    mocks.transactionsIn.mockResolvedValue({
      data: null,
      error: { message: 'transactions unavailable' },
    });

    const response = await runCron(createCronRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.stuckOrders).toBe(0);
    expect(mocks.notifyMerchant).not.toHaveBeenCalled();
    expect(mocks.loggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        message:
          'Stuck-BNPL transaction evidence was unavailable for a batch; orders requiring that evidence may be omitted',
      })
    );
    expect(mocks.loggerWarn).not.toHaveBeenCalledWith(
      expect.objectContaining({
        message:
          'Stuck-BNPL scan dropped pending/unpaid BNPL orders without provider evidence (possible stuck CredPal)',
      })
    );
  });

  it('requires provider-session evidence for pending/unpaid orders', async () => {
    mocks.limit.mockResolvedValue({
      data: [
        stuckOrder({
          id: 'order-1',
          payment_status: 'unpaid',
          payment_method: 'credpal',
          notes: null,
        }),
        stuckOrder({
          id: 'order-2',
          payment_status: 'unpaid',
          payment_method: 'credpal',
          notes: '{"credpalTransactionId":"cp-1"}',
        }),
        stuckOrder({
          id: 'order-3',
          payment_status: 'bnpl_pending',
          notes: null,
        }),
      ],
      error: null,
    });

    const response = await runCron(createCronRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.stuckOrders).toBe(1);
    expect(data.reviewOnlyOrders).toBe(1);
    // CredPal reports no checkout completion, so its provider reference still
    // pages the merchant. The Credit Direct order without any signal does not.
    expect(data.alertOrders).toBe(1);
    expect(mocks.notifyMerchant).toHaveBeenCalledTimes(1);
    expect(mocks.notifyMerchant).toHaveBeenCalledWith(
      'merchant-1',
      '⚠️ BNPL payment to confirm',
      expect.stringContaining('Check with CredPal before you fulfil it.'),
      expect.objectContaining({ order_id: 'order-2' }),
      'orders'
    );
  });
});
