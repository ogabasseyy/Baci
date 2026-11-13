import { describe, expect, it, vi } from 'vitest';
import { piggyvestFulfilmentGate } from './vtu-piggyvest-fulfilment-gate';

vi.mock('server-only', () => ({}));

const row = (status: string, metadata: Record<string, unknown> = {}) => ({
  amount: 1000,
  request_reference: 'VTU-1',
  status,
  metadata: { paymentSource: 'piggyvest_wallet', ...metadata },
});
const unclaimed = { walletPayClaimed: false, retryFailedRequested: true };

describe('piggyvestFulfilmentGate', () => {
  it('holds a never-sent pending or a failed PiggyVest row without the claim', () => {
    expect(
      piggyvestFulfilmentGate(row('pending'), unclaimed).hold
    ).toMatchObject({ status: 'processing' });
    expect(
      piggyvestFulfilmentGate(row('failed'), unclaimed).hold
    ).toMatchObject({
      status: 'failed',
    });
  });

  it('lets reconciliation and the transient re-drive through without the claim', () => {
    expect(
      piggyvestFulfilmentGate(row('processing'), unclaimed).hold
    ).toBeNull();
    expect(
      piggyvestFulfilmentGate(
        row('pending', { monnifyTransientVendError: 'timeout' }),
        unclaimed
      ).hold
    ).toBeNull();
  });

  it('never honours retryFailed for a PiggyVest row, and leaves store credit alone', () => {
    expect(piggyvestFulfilmentGate(row('failed'), unclaimed).retryFailed).toBe(
      false
    );
    const credit = {
      amount: 1000,
      request_reference: 'VTU-2',
      status: 'pending',
      metadata: {},
    };
    expect(piggyvestFulfilmentGate(credit, unclaimed)).toEqual({
      retryFailed: true,
      hold: null,
    });
  });

  it('lets the claim holder through', () => {
    expect(
      piggyvestFulfilmentGate(row('pending'), {
        walletPayClaimed: true,
        retryFailedRequested: false,
      }).hold
    ).toBeNull();
  });
});
