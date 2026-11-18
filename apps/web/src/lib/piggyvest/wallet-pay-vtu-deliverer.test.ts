import { beforeEach, describe, expect, it, vi } from 'vitest';
import { settleVtuWalletPayment } from './wallet-pay-vtu-deliverer';

vi.mock('server-only', () => ({}));

const delivery = {
  vtuDeliveryState: vi.fn(),
  finish: vi.fn(),
};
const refund = vi.fn();
vi.mock('./wallet-pay-service', () => ({
  walletPayDelivery: () => delivery,
  refundWalletPayment: (input: unknown) => refund(input),
}));

const OP = '11111111-1111-4111-8111-111111111111';
const TOKEN = '22222222-2222-4222-8222-222222222222';
const runtime = {} as never;
const input = {
  runtime,
  operationId: OP,
  purchaseRef: '33333333-3333-4333-8333-333333333333',
  claimToken: TOKEN,
  reclaimed: true,
};

beforeEach(() => {
  vi.resetAllMocks();
  refund.mockResolvedValue('pending');
});

describe('settleVtuWalletPayment (drain, VTU)', () => {
  it('records a vended purchase as fulfilled and never refunds it', async () => {
    delivery.vtuDeliveryState.mockResolvedValue('success');
    delivery.finish.mockResolvedValue('fulfilled');
    await settleVtuWalletPayment(input);
    expect(delivery.finish).toHaveBeenCalledWith(OP, 'fulfilled', TOKEN);
    expect(refund).not.toHaveBeenCalled();
  });

  it('fails a failed purchase under the claim, which owes exactly one refund, and sends it', async () => {
    delivery.vtuDeliveryState.mockResolvedValue('failed');
    delivery.finish.mockResolvedValue('refund_owed');
    await settleVtuWalletPayment(input);
    expect(delivery.finish).toHaveBeenCalledWith(OP, 'failed', TOKEN);
    expect(refund).toHaveBeenCalledWith({ runtime, paymentId: OP });
  });

  it('leaves a vend that may still be in flight to the VTU requery', async () => {
    delivery.vtuDeliveryState.mockResolvedValue('processing');
    await settleVtuWalletPayment(input);
    expect(delivery.finish).not.toHaveBeenCalled();
    expect(refund).not.toHaveBeenCalled();
  });

  it('bugfix: refunds a confirmed payment that matches no purchase instead of retrying forever (Muse)', async () => {
    delivery.vtuDeliveryState.mockResolvedValue('mismatch');
    delivery.finish.mockResolvedValue('refund_owed');
    await settleVtuWalletPayment(input);
    expect(delivery.finish).toHaveBeenCalledWith(
      expect.any(String),
      'failed',
      expect.any(String)
    );
    expect(refund).toHaveBeenCalledTimes(1);
  });

  it('raises when the outcome could not be recorded', async () => {
    delivery.vtuDeliveryState.mockResolvedValue('failed');
    delivery.finish.mockResolvedValue('conflict');
    await expect(settleVtuWalletPayment(input)).rejects.toThrow();
    expect(refund).not.toHaveBeenCalled();
  });
});
