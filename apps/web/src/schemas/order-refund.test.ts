import { describe, expect, it } from 'vitest';
import { orderRefundSchema } from './order-refund';

const manual = {
  action: 'manual',
  amount: 27574.83,
  refundedAt: '2026-09-28T12:00:00+01:00',
  method: 'bank_transfer',
  reference: 'transfer-1',
  confirmed: true,
};
describe('orderRefundSchema', () => {
  it('accepts retries and confirmed manual refunds', () => {
    expect(orderRefundSchema.safeParse({ action: 'retry' }).success).toBe(true);
    expect(orderRefundSchema.safeParse(manual).success).toBe(true);
  });
  it.each([
    { amount: -1 },
    { amount: 0 },
    { amount: 1.123 },
    { confirmed: false },
    { reference: ' ' },
    { method: 'unknown' },
    { refundedAt: '2099-01-01T00:00:00Z' },
    { refundedAt: 'yesterday' },
    { note: 'x'.repeat(501) },
  ])('rejects invalid manual refund %j', (override) =>
    expect(
      orderRefundSchema.safeParse({ ...manual, ...override }).success
    ).toBe(false));
});
