import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const bookingContextSource = readFileSync(
  `${process.cwd()}/src/app/api/shipping/book/load-direct-booking-context.ts`,
  'utf8'
);

describe('direct shipping booking merchant wallet guard', () => {
  it('fails closed and delegates wallet orders to the order workflow', () => {
    expect(bookingContextSource).toContain(
      "order.shipping_funding_source === 'merchant_wallet'"
    );
    expect(bookingContextSource).toContain('USE_ORDER_SHIPMENT_BOOKING');
  });
});
