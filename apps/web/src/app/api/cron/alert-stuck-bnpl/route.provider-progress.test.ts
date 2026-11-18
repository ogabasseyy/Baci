import { beforeEach, describe, expect, it } from 'vitest';
import { cronHarness } from './route.test-support';

const { createCronRequest, mocks, resetCronMocks, runCron, stuckOrder } =
  cronHarness;

function scanOrder(
  provider: string,
  notes: string | null,
  payment_status = 'bnpl_pending'
) {
  mocks.limit.mockResolvedValue({
    data: [stuckOrder({ payment_method: provider, payment_status, notes })],
    error: null,
  });
}

describe('Klump and CredPal merchant alert evidence', () => {
  beforeEach(resetCronMocks);

  it.each([
    ['klump', 'klumpTransactionId'],
    ['klump', 'klump_transaction_id'],
    ['credpal', 'credpalTransactionId'],
    ['credpal', 'credpal_transaction_id'],
  ])('does not page for %s %s notes with only a pending transaction', async (provider, key) => {
    scanOrder(provider, JSON.stringify({ [key]: 'provider-application-id' }));
    mocks.transactionsIn.mockResolvedValue({
      data: [
        {
          order_id: 'order-1',
          status: 'pending',
          gateway: provider,
          gateway_reference: 'BAC-merchant-reference',
        },
      ],
      error: null,
    });
    const response = await runCron(createCronRequest());
    expect(await response.json()).toMatchObject({
      alertOrders: 0,
      reviewOnlyOrders: 1,
    });
    expect(mocks.notifyMerchant).not.toHaveBeenCalled();
  });

  it.each([
    'klump',
    'credpal',
  ])('does not promote %s notes when the evidence lookup fails', async (provider) => {
    scanOrder(
      provider,
      JSON.stringify({
        [`${provider}TransactionId`]: 'provider-application-id',
      })
    );
    mocks.transactionsIn.mockResolvedValue({
      data: null,
      error: { message: 'unavailable' },
    });
    const response = await runCron(createCronRequest());
    expect(await response.json()).toMatchObject({ alertOrders: 0 });
    expect(mocks.notifyMerchant).not.toHaveBeenCalled();
  });

  it.each([
    ['klump', 'processing'],
    ['klump', 'completed'],
    ['credpal', 'processing'],
    ['credpal', 'completed'],
  ])('pages for %s %s evidence using its merchant reference', async (provider, status) => {
    scanOrder(
      provider,
      JSON.stringify({ [`${provider}TransactionId`]: 'different-provider-id' })
    );
    mocks.transactionsIn.mockResolvedValue({
      data: [
        {
          order_id: 'order-1',
          status,
          gateway: provider,
          gateway_reference: 'BAC-merchant-reference',
        },
      ],
      error: null,
    });
    const response = await runCron(createCronRequest());
    expect(await response.json()).toMatchObject({ alertOrders: 1 });
    expect(mocks.notifyMerchant).toHaveBeenCalledTimes(1);
  });

  it.each([
    'klump',
    'credpal',
  ])('pages for approved %s orders without notes or transaction evidence', async (provider) => {
    scanOrder(provider, null, 'bnpl_approved');
    const response = await runCron(createCronRequest());
    expect(await response.json()).toMatchObject({ alertOrders: 1 });
    expect(mocks.notifyMerchant).toHaveBeenCalledTimes(1);
  });
});
