import { beforeEach, describe, expect, it } from 'vitest';
import { cronHarness } from './route.test-support';

const { createCronRequest, mocks, resetCronMocks, runCron, stuckOrder } =
  cronHarness;

describe('BNPL evidence scan retry safety', () => {
  beforeEach(resetCronMocks);

  it('rejects an incomplete scan before any write or push, then delivers once per merchant on retry', async () => {
    mocks.limit.mockResolvedValue({
      data: [
        stuckOrder({
          id: 'approved-order',
          merchant_id: 'approved-merchant',
          payment_status: 'bnpl_approved',
        }),
        stuckOrder({
          id: 'lookup-order',
          merchant_id: 'lookup-merchant',
          payment_status: 'unpaid',
          notes: '{"creditDirectTransactionId":"active-txn"}',
        }),
      ],
      error: null,
    });
    const progressed = {
      id: 'transaction-1',
      order_id: 'lookup-order',
      status: 'processing',
      gateway: 'credit_direct',
      gateway_reference: 'active-txn',
    };
    mocks.transactionsIn
      .mockResolvedValueOnce({ data: [progressed], error: null })
      .mockResolvedValueOnce({
        data: null,
        error: { message: 'later page failed' },
      });

    const failed = await runCron(createCronRequest());
    expect(failed.status).toBe(503);
    expect(await failed.json()).toMatchObject({
      code: 'BNPL_EVIDENCE_INCOMPLETE',
    });
    expect(mocks.reviewInsert).not.toHaveBeenCalled();
    expect(mocks.notifyMerchant).not.toHaveBeenCalled();

    mocks.transactionsIn.mockResolvedValue({ data: [progressed], error: null });
    const retried = await runCron(createCronRequest());
    expect(retried.status).toBe(200);
    expect(await retried.json()).toMatchObject({
      alertOrders: 2,
      merchantsNotified: 2,
    });
    expect(mocks.notifyMerchant).toHaveBeenCalledTimes(2);
    expect(
      mocks.notifyMerchant.mock.calls.map(([merchant]) => merchant).sort()
    ).toEqual(['approved-merchant', 'lookup-merchant']);
    expect(mocks.reviewInsert).toHaveBeenCalledTimes(2);
  });
});
