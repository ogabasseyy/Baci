import { beforeEach, describe, expect, it, vi } from 'vitest';
import { refundUncollectedPayment } from './wallet-pay-refund-uncollected';

vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({ finish: vi.fn(), refund: vi.fn() }));
vi.mock('./wallet-pay-service', () => ({
  walletPayDelivery: () => ({ finish: mocks.finish }),
  refundWalletPayment: mocks.refund,
}));

const runtime = {} as never;
const input = {
  runtime,
  operationId: 'op',
  purchaseRef: 'lookup',
  claimToken: 'tok',
  reclaimed: false,
};

beforeEach(() => vi.resetAllMocks());

describe('refundUncollectedPayment', () => {
  it('fails the delivery under the drain claim, then sends the one refund', async () => {
    mocks.finish.mockResolvedValue('refund_owed');
    await refundUncollectedPayment(input);
    expect(mocks.finish).toHaveBeenCalledWith('op', 'failed', 'tok');
    expect(mocks.refund).toHaveBeenCalledWith({ runtime, paymentId: 'op' });
  });

  it('sends nothing when the claim is no longer the drain’s', async () => {
    mocks.finish.mockResolvedValue('conflict');
    await expect(refundUncollectedPayment(input)).rejects.toThrow();
    expect(mocks.refund).not.toHaveBeenCalled();
  });
});
