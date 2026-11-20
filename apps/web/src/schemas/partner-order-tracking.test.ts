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
});
