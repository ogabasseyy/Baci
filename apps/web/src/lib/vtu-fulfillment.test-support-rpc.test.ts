import { describe, expect, it, vi } from 'vitest';
import { createPendingTransactionRpcMock } from './vtu-fulfillment.test-support-rpc';

const transactionRow = { metadata: { existing: true } };

describe('createPendingTransactionRpcMock', () => {
  it('answers the notification claim with the row metadata marked attempted', async () => {
    const rpc = createPendingTransactionRpcMock({ transactionRow });

    await expect(
      rpc('claim_vtu_customer_notification_attempt')
    ).resolves.toEqual({
      data: { existing: true, customerNotificationAttempted: true },
      error: null,
    });
  });

  it('returns the scripted retry-claim error', async () => {
    const retryClaimError = { message: 'boom' };
    const rpc = createPendingTransactionRpcMock({
      retryClaimData: null,
      retryClaimError,
      transactionRow,
    } as never);

    await expect(rpc('claim_failed_vtu_retry')).resolves.toEqual({
      data: null,
      error: retryClaimError,
    });
  });

  it('delegates unknown RPCs to rpcImpl, or answers empty without one', async () => {
    const rpcImpl = vi.fn().mockResolvedValue({ data: 'x', error: null });

    await expect(
      createPendingTransactionRpcMock({ rpcImpl, transactionRow })('other', {
        a: 1,
      })
    ).resolves.toEqual({ data: 'x', error: null });
    expect(rpcImpl).toHaveBeenCalledWith('other', { a: 1 });
    await expect(
      createPendingTransactionRpcMock({ transactionRow })('other')
    ).resolves.toEqual({ data: null, error: null });
  });
});
