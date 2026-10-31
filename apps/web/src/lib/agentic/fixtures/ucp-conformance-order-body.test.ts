// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { MAJOR_PRICE } from './ucp-conformance-data';
import { orderBody } from './ucp-conformance-order-body';

describe('UCP conformance order body', () => {
  it('builds an order body in major units for the requested shipping status', () => {
    const body = orderBody('pending');

    expect(body.shipping_status).toBe('pending');
    expect(orderBody('delivered').shipping_status).toBe('delivered');
    expect(body.order_items[0].price).toBe(MAJOR_PRICE);
    expect(body.order_items[0].quantity).toBe(2);
    expect(body.total).toBe(body.order_items[0].line_extension_amount);
    expect(body.total).toBeCloseTo(MAJOR_PRICE * 2, 10);
  });

  it('returns the same inputs on every call', () => {
    expect(orderBody('pending')).toEqual(orderBody('pending'));
  });
});
