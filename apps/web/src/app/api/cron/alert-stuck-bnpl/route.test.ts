import { beforeEach, describe, expect, it } from 'vitest';
import { cronHarness } from './route.test-support';

const { createCronRequest, mocks, resetCronMocks, runCron, stuckOrder } =
  cronHarness;

describe('GET /api/cron/alert-stuck-bnpl', () => {
  beforeEach(resetCronMocks);

  it('returns 401 when the cron secret does not match', async () => {
    const response = await runCron(createCronRequest('Bearer wrong-secret'));

    expect(response.status).toBe(401);
    expect(mocks.limit).not.toHaveBeenCalled();
  });

  it('returns 401 when the authorization header is missing', async () => {
    const response = await runCron(createCronRequest(null));

    expect(response.status).toBe(401);
  });

  it('reports zero stuck orders without notifying anyone', async () => {
    const response = await runCron(createCronRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({
      success: true,
      stuckOrders: 0,
      alertOrders: 0,
      reviewOnlyOrders: 0,
      merchants: 0,
      merchantsNotified: 0,
    });
    expect(mocks.notifyMerchant).not.toHaveBeenCalled();
  });

  it('does not page the merchant for orders that only opened a provider session', async () => {
    mocks.limit.mockResolvedValue({
      data: [
        stuckOrder({
          id: 'order-abandoned',
          notes: '{"credit_directTransactionId":"txn-1"}',
        }),
      ],
      error: null,
    });

    const response = await runCron(createCronRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({
      success: true,
      stuckOrders: 0,
      alertOrders: 0,
      reviewOnlyOrders: 1,
      merchants: 0,
      merchantsNotified: 0,
    });
    expect(mocks.reviewInsert).toHaveBeenCalledWith(
      expect.objectContaining({ order_id: 'order-abandoned' })
    );
    expect(mocks.notifyMerchant).not.toHaveBeenCalled();
  });

  it('keeps paging for an approved provider that reports no SDK completion', async () => {
    mocks.limit.mockResolvedValue({
      data: [
        stuckOrder({
          id: 'order-klump',
          order_number: 'ORD-KLUMP',
          payment_method: 'klump',
          payment_status: 'bnpl_approved',
          notes: '{"klumpTransactionId":"txn-9"}',
        }),
      ],
      error: null,
    });

    const response = await runCron(createCronRequest());
    const data = await response.json();

    expect(data).toEqual(
      expect.objectContaining({ stuckOrders: 1, alertOrders: 1 })
    );
    expect(mocks.notifyMerchant).toHaveBeenCalledWith(
      'merchant-1',
      '⚠️ BNPL payment to confirm',
      expect.stringContaining('Check with Klump before you fulfil it.'),
      expect.objectContaining({ order_id: 'order-klump' }),
      'orders'
    );
  });

  it('does not page for a Klump BNPL-pending order without provider evidence', async () => {
    mocks.limit.mockResolvedValue({
      data: [stuckOrder({ payment_method: 'klump', notes: null })],
      error: null,
    });
    const response = await runCron(createCronRequest());
    expect(await response.json()).toMatchObject({
      stuckOrders: 0,
      reviewOnlyOrders: 0,
    });
    expect(mocks.notifyMerchant).not.toHaveBeenCalled();
  });

  it('pages only for the orders with an approval or completion signal', async () => {
    mocks.limit.mockResolvedValue({
      data: [
        stuckOrder({
          id: 'order-abandoned',
          total: 900000,
          notes: '{"credit_directTransactionId":"txn-1"}',
        }),
        stuckOrder({
          id: 'order-approved',
          order_number: 'ORD-APPROVED',
          total: 250000,
          payment_status: 'bnpl_approved',
          updated_at: '2020-01-01T00:00:00.000Z',
          notes: '{"credit_directTransactionId":"txn-2"}',
        }),
      ],
      error: null,
    });

    const response = await runCron(createCronRequest());
    const data = await response.json();

    expect(data.stuckOrders).toBe(1);
    expect(data.reviewOnlyOrders).toBe(1);
    expect(data.alertOrders).toBe(1);
    expect(mocks.notifyMerchant).toHaveBeenCalledTimes(1);
    expect(mocks.notifyMerchant).toHaveBeenCalledWith(
      'merchant-1',
      '⚠️ BNPL payment to confirm',
      expect.stringMatching(
        /^Order #ORD-APPROVED \(₦250,000\) went through Credit Direct checkout .* Check with Credit Direct before you fulfil it\.$/
      ),
      expect.objectContaining({
        stuck_order_count: 1,
        total_amount: 250000,
        oldest_order_id: 'order-approved',
        order_id: 'order-approved',
      }),
      'orders'
    );
  });

  it('sends one aggregated alert per merchant with stuck orders', async () => {
    mocks.limit.mockResolvedValue({
      data: [
        stuckOrder({ id: 'order-1', order_number: 'ORD-1', total: 100000 }),
        stuckOrder({
          id: 'order-2',
          order_number: 'ORD-2',
          total: 50000,
        }),
        stuckOrder({
          id: 'order-3',
          order_number: 'ORD-3',
          merchant_id: 'merchant-2',
          total: 25000,
        }),
      ],
      error: null,
    });

    const response = await runCron(createCronRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({
      success: true,
      stuckOrders: 3,
      alertOrders: 3,
      reviewOnlyOrders: 0,
      merchants: 2,
      merchantsNotified: 2,
    });

    expect(mocks.notifyMerchant).toHaveBeenCalledTimes(2);
    expect(mocks.notifyMerchant).toHaveBeenCalledWith(
      'merchant-1',
      '⚠️ 2 BNPL payments to confirm',
      expect.stringContaining('2 orders totalling ₦150,000'),
      expect.objectContaining({
        type: 'stuck_bnpl_alert',
        stuck_order_count: 2,
        total_amount: 150000,
        oldest_order_id: 'order-1',
      }),
      'orders'
    );
    expect(mocks.notifyMerchant).toHaveBeenCalledWith(
      'merchant-2',
      '⚠️ BNPL payment to confirm',
      expect.stringContaining('(₦25,000) went through Credit Direct'),
      expect.objectContaining({ stuck_order_count: 1 }),
      'orders'
    );
    expect(mocks.loggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'BNPL orders stuck awaiting provider confirmation',
        merchantId: 'merchant-1',
        stuckOrderCount: 2,
      })
    );
  });
});
