import { describe, expect, it } from 'vitest';
import { buildManualRefundPayload } from './build-manual-refund-payload';

const base = {
  amount: '100',
  confirmed: true,
  date: '2026-09-28T13:00',
  method: 'paystack',
  note: '',
  reference: 'pin-1',
};

describe('buildManualRefundPayload', () => {
  it('omits the leg pin when no capture is selected', () => {
    expect(buildManualRefundPayload({ ...base, paymentLegId: null })).toEqual({
      action: 'manual',
      amount: 100,
      refundedAt: '2026-09-28T13:00:00+01:00',
      method: 'paystack',
      reference: 'pin-1',
      note: '',
      confirmed: true,
    });
  });
  it('names the selected capture for multi-leg Paystack records', () => {
    expect(
      buildManualRefundPayload({ ...base, paymentLegId: 'leg-2' })
    ).toMatchObject({ paymentTransactionId: 'leg-2' });
  });
});
