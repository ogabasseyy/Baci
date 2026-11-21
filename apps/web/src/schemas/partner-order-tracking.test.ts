import { describe, expect, it } from 'vitest';
import { orderTrackingSchema } from './partner-order-tracking';

const receipt = {
  order_id: '20000000-0000-4000-8000-000000000001',
  partner_order_id: 'example-order',
  payment_status: 'paid',
  shipping_status: 'processing',
  tracking: null,
};

describe('partner order tracking schema', () => {
  it('allows an unbooked order and excludes private data', () => {
    expect(orderTrackingSchema.parse({ ...receipt, phone: 'private' })).toEqual(
      receipt
    );
  });

  it('normalizes legacy statuses and masks unrecognized internal statuses', () => {
    expect(
      orderTrackingSchema.parse({
        ...receipt,
        shipping_status: 'completed',
        payment_status: 'partially_refunded',
      })
    ).toMatchObject({
      shipping_status: 'delivered',
      payment_status: 'partially_refunded',
    });
    expect(
      orderTrackingSchema.parse({
        ...receipt,
        shipping_status: 'canceled',
        payment_status: 'unpublished-status',
      })
    ).toMatchObject({
      shipping_status: 'cancelled',
      payment_status: 'unknown',
    });
    expect(
      orderTrackingSchema.parse({
        ...receipt,
        shipping_status: 'unpublished-status',
      }).shipping_status
    ).toBe('unknown');
  });

  it('requires the carrier and waybill once tracking is present', () => {
    expect(
      orderTrackingSchema.safeParse({
        ...receipt,
        tracking: { provider: 'GIGL' },
      }).success
    ).toBe(false);
    expect(
      orderTrackingSchema.safeParse({
        ...receipt,
        tracking: { provider: 'GIGL', tracking_number: 'fixture-number' },
      }).success
    ).toBe(true);
  });

  it.each([
    { provider: '', tracking_number: 'reference' },
    { provider: 'A'.repeat(33), tracking_number: 'reference' },
    { provider: 'bad provider', tracking_number: 'reference' },
    { provider: 'GIGL', tracking_number: '' },
    { provider: 'GIGL', tracking_number: 'a'.repeat(129) },
  ])('rejects an invalid tracking projection', (tracking) => {
    expect(
      orderTrackingSchema.safeParse({ ...receipt, tracking }).success
    ).toBe(false);
  });

  it('does not expose extra fields in the tracking payload', () => {
    expect(
      orderTrackingSchema.parse({
        ...receipt,
        tracking: {
          provider: 'GIGL',
          tracking_number: 'fixture-number',
          receiver_phone: 'private',
        },
      }).tracking
    ).toEqual({ provider: 'GIGL', tracking_number: 'fixture-number' });
  });
});
