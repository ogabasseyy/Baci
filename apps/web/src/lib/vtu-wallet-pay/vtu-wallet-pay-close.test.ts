import { describe, expect, it, vi } from 'vitest';
import {
  cancelVtuWalletPay,
  closeUnpaidQuietly,
  ENDED_UNPAID,
  recheckStatus,
} from './vtu-wallet-pay-close';

vi.mock('server-only', () => ({}));

const OP = '11111111-1111-4111-8111-111111111111';
const ref = {
  runtime: {} as never,
  scope: {} as never,
  transactionId: '33333333-3333-4333-8333-333333333333',
};

describe('vtu wallet pay close helpers', () => {
  it('closes only payments that ended unpaid', () => {
    expect([...ENDED_UNPAID].sort()).toEqual([
      'expired',
      'insufficient',
      'released',
    ]);
  });

  it('re-checks from the stored state alone', () => {
    expect(recheckStatus('confirmed')).toBe('confirmed');
    expect(recheckStatus('released')).toBe('released');
    expect(recheckStatus('dispatched')).toBe('pending');
  });

  it('never throws from a failed close', async () => {
    const close = vi.fn(async () => {
      throw new Error('db down');
    });
    await expect(closeUnpaidQuietly(close, ref)).resolves.toBe(false);
  });

  it('bugfix: a sheet closed before any PIN cancels the issued payment (Codex P2)', async () => {
    const close = vi.fn(async () => true);
    const response = await cancelVtuWalletPay(close, ref, OP);
    expect(close).toHaveBeenCalledWith({ ...ref, cancelOperationId: OP });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({
      status: 'cancelled',
      transactionId: ref.transactionId,
    });
  });

  it('reports a purchase it could not cancel (a payment was already reserved)', async () => {
    const response = await cancelVtuWalletPay(
      vi.fn(async () => false),
      ref,
      OP
    );
    await expect(response.json()).resolves.toMatchObject({
      status: 'not_cancelled',
    });
  });
});
