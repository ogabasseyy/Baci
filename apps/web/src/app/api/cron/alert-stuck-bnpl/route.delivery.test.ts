import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createCronRequest,
  mocks,
  resetCronMocks,
  runCron,
  stuckOrder,
} from './route.test-support';

describe('GET /api/cron/alert-stuck-bnpl', () => {
  beforeEach(resetCronMocks);

  it('reports merchants whose push delivery failed', async () => {
    mocks.limit.mockResolvedValue({
      data: [stuckOrder()],
      error: null,
    });
    mocks.notifyMerchant.mockResolvedValue({
      sent: 0,
      failed: 1,
      errors: ['no active tokens'],
    });

    const response = await runCron(createCronRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({
      success: true,
      stuckOrders: 1,
      alertOrders: 1,
      reviewOnlyOrders: 0,
      merchants: 1,
      merchantsNotified: 0,
      pushFailures: ['merchant-1'],
    });
  });

  it('keeps alerting and reports Credit Direct review insert failures', async () => {
    mocks.limit.mockResolvedValue({
      data: [stuckOrder()],
      error: null,
    });
    mocks.reviewInsert.mockResolvedValue({
      error: { code: 'XX000', message: 'database unavailable' },
    });

    const response = await runCron(createCronRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({
      success: true,
      stuckOrders: 1,
      alertOrders: 1,
      reviewOnlyOrders: 0,
      merchants: 1,
      merchantsNotified: 1,
      reviewFailures: ['order-1'],
    });
    expect(mocks.notifyMerchant).toHaveBeenCalledTimes(1);
    expect(mocks.loggerError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Failed to file stuck Credit Direct reconciliation review',
        orderId: 'order-1',
      })
    );
  });

  it('files reviews in bounded batches and reports failures deterministically', async () => {
    const firstBatchResolvers = new Map<
      string,
      (result: { error: null | { code: string } }) => void
    >();
    mocks.limit.mockResolvedValue({
      data: Array.from({ length: 6 }, (_, index) =>
        stuckOrder({ id: `order-${index + 1}` })
      ),
      error: null,
    });
    mocks.reviewInsert.mockImplementation((row: { order_id: string }) =>
      row.order_id === 'order-6'
        ? Promise.resolve({ error: { code: 'XX000' } })
        : new Promise((resolve) => {
            firstBatchResolvers.set(row.order_id, resolve);
          })
    );

    const responsePromise = runCron(createCronRequest());
    await vi.waitFor(() => {
      expect(mocks.reviewInsert).toHaveBeenCalledTimes(5);
    });
    expect(mocks.reviewInsert).not.toHaveBeenCalledWith(
      expect.objectContaining({ order_id: 'order-6' })
    );
    expect(mocks.notifyMerchant).not.toHaveBeenCalled();

    firstBatchResolvers.get('order-5')?.({ error: null });
    firstBatchResolvers.get('order-2')?.({ error: { code: 'XX000' } });
    firstBatchResolvers.get('order-1')?.({ error: null });
    firstBatchResolvers.get('order-4')?.({ error: null });
    firstBatchResolvers.get('order-3')?.({ error: null });

    const response = await responsePromise;
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.reviewInsert).toHaveBeenCalledTimes(6);
    expect(mocks.createAdminClient).toHaveBeenCalledTimes(1);
    expect(data.reviewFailures).toEqual(['order-2', 'order-6']);
    expect(mocks.notifyMerchant).toHaveBeenCalledTimes(1);
  });

  it('notifies merchants concurrently instead of waiting for each merchant serially', async () => {
    let resolveFirstPush:
      | ((value: { sent: number; failed: number }) => void)
      | undefined;
    const firstPush = new Promise<{ sent: number; failed: number }>(
      (resolve) => {
        resolveFirstPush = resolve;
      }
    );
    mocks.limit.mockResolvedValue({
      data: [
        stuckOrder({ id: 'order-1', merchant_id: 'merchant-1' }),
        stuckOrder({ id: 'order-2', merchant_id: 'merchant-2' }),
      ],
      error: null,
    });
    mocks.notifyMerchant.mockImplementation((merchantId: string) =>
      merchantId === 'merchant-1'
        ? firstPush
        : Promise.resolve({ sent: 1, failed: 0 })
    );

    const responsePromise = runCron(createCronRequest());
    await vi.waitFor(() => {
      expect(mocks.notifyMerchant).toHaveBeenCalledWith(
        'merchant-1',
        expect.any(String),
        expect.any(String),
        expect.any(Object),
        'orders'
      );
      expect(mocks.notifyMerchant).toHaveBeenCalledWith(
        'merchant-2',
        expect.any(String),
        expect.any(String),
        expect.any(Object),
        'orders'
      );
    });

    if (!resolveFirstPush) {
      throw new Error('First push resolver was not initialized');
    }
    resolveFirstPush({ sent: 1, failed: 0 });
    const response = await responsePromise;
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.merchantsNotified).toBe(2);
  });

  it('still succeeds when the push helper throws', async () => {
    mocks.limit.mockResolvedValue({
      data: [stuckOrder()],
      error: null,
    });
    mocks.notifyMerchant.mockRejectedValue(new Error('expo outage'));

    const response = await runCron(createCronRequest());
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.pushFailures).toEqual(['merchant-1']);
    expect(mocks.loggerError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Failed to push stuck-BNPL alert' })
    );
  });

  it('returns 500 when the order scan fails', async () => {
    mocks.limit.mockResolvedValue({
      data: null,
      error: { message: 'db down' },
    });

    const response = await runCron(createCronRequest());
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data).toEqual({ error: 'Failed to scan orders' });
    expect(mocks.notifyMerchant).not.toHaveBeenCalled();
  });
});
