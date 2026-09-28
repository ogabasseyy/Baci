import { describe, expect, it } from 'vitest';
import { paystackRefundEventSchema } from './paystack-refund-event';

describe('paystackRefundEventSchema', () => {
  it('parses a refund event keyed by provider refund ID', () => {
    const parsed = paystackRefundEventSchema.safeParse({
      data: { id: 42, status: 'processed', transaction: 123 },
      event: 'refund.processed',
    });

    expect(parsed.success).toBe(true);
  });

  it('parses nested and flat payment references', () => {
    expect(
      paystackRefundEventSchema.safeParse({
        data: { transaction: { reference: 'PSK-1' } },
        event: 'refund.failed',
      }).success
    ).toBe(true);
    expect(
      paystackRefundEventSchema.safeParse({
        data: { transaction_reference: 'PAYMENT-1' },
        event: 'refund.processed',
      }).success
    ).toBe(true);
  });

  it('rejects non-refund events', () => {
    expect(
      paystackRefundEventSchema.safeParse({
        data: {},
        event: 'charge.success',
      }).success
    ).toBe(false);
  });

  it.each([
    [{ data: { id: '42' }, event: 'refund.processed' }],
    [{ data: { transaction: { reference: 123 } }, event: 'refund.failed' }],
    [{ data: 'not-an-object', event: 'refund.processed' }],
    [{ data: [], event: 'refund.processed' }],
  ])('rejects malformed payloads (%j)', (payload) => {
    expect(paystackRefundEventSchema.safeParse(payload).success).toBe(false);
  });

  it.each([
    [{ event: 'refund.processed' }],
    [{ data: {}, event: 'refund.processed' }],
    [{ data: { status: 'processed' }, event: 'refund.processed' }],
    [{ data: { id: 0 }, event: 'refund.processed' }],
    [{ data: { id: -5 }, event: 'refund.processed' }],
    [{ data: { transaction: 123 }, event: 'refund.processed' }],
    [{ data: { transaction: { reference: '' } }, event: 'refund.failed' }],
    [{ data: { transaction_reference: '' }, event: 'refund.processed' }],
  ])('rejects events without a usable identifier (%j)', (payload) => {
    expect(paystackRefundEventSchema.safeParse(payload).success).toBe(false);
  });

  it('passes unknown provider fields through', () => {
    const parsed = paystackRefundEventSchema.safeParse({
      data: { domain: 'live', id: 42 },
      event: 'refund.processed',
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.data).toMatchObject({ domain: 'live', id: 42 });
    }
  });
});
