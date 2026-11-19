import { describe, expect, it, vi } from 'vitest';
import { createVtuTransactionUpdateMock } from './vtu-fulfillment.test-support-update';

function setup(options = {}) {
  const claimMaybeSingle = vi
    .fn()
    .mockResolvedValue({ data: { id: 'claim' }, error: null });
  const notificationClaimMaybeSingle = vi
    .fn()
    .mockResolvedValue({ data: { id: 'notify' }, error: null });
  const updatePayloads: unknown[] = [];
  const update = createVtuTransactionUpdateMock({
    claimMaybeSingle,
    notificationClaimMaybeSingle,
    options: { transactionRow: {}, updatePayloads, ...options } as never,
    transactionRow: {},
  });
  return { update, updatePayloads };
}

describe('createVtuTransactionUpdateMock', () => {
  it('records every payload and routes a claim to the claim chain', async () => {
    const { update, updatePayloads } = setup();

    const chain = update({ status: 'processing' }) as unknown as {
      maybeSingle: () => Promise<unknown>;
    };

    expect(updatePayloads).toEqual([{ status: 'processing' }]);
    await expect(chain.maybeSingle()).resolves.toEqual({
      data: { id: 'claim' },
      error: null,
    });
  });

  it('keeps failing purchase writes across calls until the scripted errors run out', async () => {
    const failure = { message: 'write failed' };
    const { update } = setup({ purchaseUpdateErrors: [failure, null] });

    const first = await update({ status: 'successful', metadata: {} });
    const second = await update({ status: 'successful', metadata: {} });

    expect(first).toEqual({ data: null, error: failure });
    expect(second).toEqual({ data: null, error: null });
  });
});
