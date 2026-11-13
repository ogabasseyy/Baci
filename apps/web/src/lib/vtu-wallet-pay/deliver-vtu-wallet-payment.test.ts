import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deliverVtuWalletPayment,
  VtuWalletPaymentMismatchError,
} from './deliver-vtu-wallet-payment';

vi.mock('server-only', () => ({}));

const OP = '11111111-1111-4111-8111-111111111111';
const TXN = '33333333-3333-4333-8333-333333333333';
const TOKEN = '22222222-2222-4222-8222-222222222222';
const input = { transactionId: TXN, operationId: OP, amountKobo: 100000 };
const claimed = (status: 'claimed' | 'reclaimed' = 'claimed') => ({
  status,
  purpose: 'vtu',
  purchaseRef: TXN,
  amountKobo: 100000,
  claimToken: TOKEN,
});
const success = { status: 'successful', amount: 1000, reference: 'VTU-1' };
const failed = {
  status: 'failed',
  amount: 1000,
  reference: 'VTU-1',
  error: 'x',
};

const deps = {
  claim: vi.fn(),
  finish: vi.fn(),
  refund: vi.fn(),
  deliveryState: vi.fn(),
  fulfil: vi.fn(),
};

beforeEach(() => {
  vi.resetAllMocks();
  deps.refund.mockResolvedValue('pending');
});

describe('deliverVtuWalletPayment', () => {
  it('vends once under the claim and records it fulfilled', async () => {
    deps.claim.mockResolvedValue(claimed());
    deps.fulfil.mockResolvedValue(success);
    deps.finish.mockResolvedValue('fulfilled');
    await expect(deliverVtuWalletPayment(input, deps)).resolves.toEqual({
      kind: 'result',
      result: success,
    });
    expect(deps.fulfil).toHaveBeenCalledTimes(1);
    expect(deps.fulfil).toHaveBeenCalledWith(true);
    expect(deps.finish).toHaveBeenCalledWith(OP, 'fulfilled', TOKEN);
    expect(deps.refund).not.toHaveBeenCalled();
  });

  it('owes exactly one refund when the vend fails', async () => {
    deps.claim.mockResolvedValue(claimed());
    deps.fulfil.mockResolvedValue(failed);
    deps.finish.mockResolvedValue('refund_owed');
    await deliverVtuWalletPayment(input, deps);
    expect(deps.finish).toHaveBeenCalledWith(OP, 'failed', TOKEN);
    expect(deps.refund).toHaveBeenCalledTimes(1);
  });

  it('keeps the claim while the vend is still processing', async () => {
    deps.claim.mockResolvedValue(claimed());
    deps.fulfil.mockResolvedValue({
      status: 'processing',
      amount: 1000,
      reference: 'VTU-1',
    });
    await deliverVtuWalletPayment(input, deps);
    expect(deps.finish).not.toHaveBeenCalled();
    expect(deps.refund).not.toHaveBeenCalled();
  });

  it('never vends again for a reclaimed claim: the stored purchase decides', async () => {
    deps.claim.mockResolvedValue(claimed('reclaimed'));
    deps.deliveryState.mockResolvedValue('failed');
    deps.finish.mockResolvedValue('refund_owed');
    deps.fulfil.mockResolvedValue(failed);
    await deliverVtuWalletPayment(input, deps);
    expect(deps.fulfil).toHaveBeenCalledWith(false);
    expect(deps.fulfil).not.toHaveBeenCalledWith(true);
    expect(deps.finish).toHaveBeenCalledWith(OP, 'failed', TOKEN);
  });

  it('bugfix: records a final result reconciled while reclaiming a processing vend (Codex P2)', async () => {
    deps.claim.mockResolvedValue(claimed('reclaimed'));
    deps.deliveryState.mockResolvedValue('processing');
    deps.finish.mockResolvedValue('fulfilled');
    deps.fulfil.mockResolvedValue(success);
    await deliverVtuWalletPayment(input, deps);
    expect(deps.fulfil).toHaveBeenCalledWith(false);
    expect(deps.finish).toHaveBeenCalledWith(OP, 'fulfilled', TOKEN);
  });

  it('keeps the claim while a reclaimed vend is still processing', async () => {
    deps.claim.mockResolvedValue(claimed('reclaimed'));
    deps.deliveryState.mockResolvedValue('processing');
    deps.fulfil.mockResolvedValue({ ...success, status: 'processing' });
    await deliverVtuWalletPayment(input, deps);
    expect(deps.finish).not.toHaveBeenCalled();
  });

  it('waits for a payment not yet confirmed and for a delivery in progress', async () => {
    deps.claim.mockResolvedValue({ status: 'not_confirmed' });
    await expect(deliverVtuWalletPayment(input, deps)).resolves.toEqual({
      kind: 'payment_pending',
    });
    deps.claim.mockResolvedValue({ status: 'busy' });
    await expect(deliverVtuWalletPayment(input, deps)).resolves.toEqual({
      kind: 'delivering',
    });
    expect(deps.fulfil).not.toHaveBeenCalled();
  });

  it('reads the finished purchase without vending once delivery is recorded', async () => {
    deps.claim.mockResolvedValue({ status: 'refund_owed' });
    deps.fulfil.mockResolvedValue(failed);
    await deliverVtuWalletPayment(input, deps);
    expect(deps.fulfil).toHaveBeenCalledWith(false);
  });

  it('refuses a payment for another purchase or amount, vending nothing', async () => {
    deps.claim.mockResolvedValue({ ...claimed(), amountKobo: 99900 });
    await expect(deliverVtuWalletPayment(input, deps)).rejects.toBeInstanceOf(
      VtuWalletPaymentMismatchError
    );
    deps.claim.mockResolvedValue({ ...claimed(), purpose: 'imei_check' });
    await expect(deliverVtuWalletPayment(input, deps)).rejects.toBeInstanceOf(
      VtuWalletPaymentMismatchError
    );
    expect(deps.fulfil).not.toHaveBeenCalled();
  });
});
