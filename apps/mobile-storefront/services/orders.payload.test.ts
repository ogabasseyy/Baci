import { buildOrderPayload } from './orders.payload';
import type { CreateOrderRequest } from './orders.schemas';

const baseRequest: CreateOrderRequest = {
  customer_email: 'ada@example.com',
  customer_name: 'Ada Lovelace',
  customer_phone: '08031234567',
  items: [{ id: 'p-1', name: 'Widget', quantity: 1, price: 1000 }],
  subtotal: 1000,
  shipping_fee: 0,
  payment_method: 'paystack',
  shipping_address: {
    firstName: 'Ada',
    lastName: 'Lovelace',
    address: 'No. 5 Example Plaza',
    city: 'Lagos',
    state: 'Lagos',
  },
  source: 'mobile_app',
};

describe('buildOrderPayload — discount code', () => {
  it('includes discount_code only when set and always sends discount_amount 0', () => {
    const payload = buildOrderPayload({
      merchantId: 'merchant-1',
      request: { ...baseRequest, discount_code: 'SAVE10' },
    });

    expect(payload.discount_code).toBe('SAVE10');
    expect(payload.discount_amount).toBe(0);
  });

  it('omits discount_code when absent and never forwards a stale discount_amount', () => {
    const payload = buildOrderPayload({
      merchantId: 'merchant-1',
      // A stale/non-zero discount_amount must NOT reach the route (it rejects it).
      request: { ...baseRequest, discount_amount: 999 },
    });

    expect('discount_code' in payload).toBe(false);
    expect(payload.discount_amount).toBe(0);
  });

  it('preserves the REDVAULT method without sending a client discount amount', () => {
    const payload = buildOrderPayload({
      merchantId: 'merchant-1',
      request: { ...baseRequest, payment_method: 'uba_redvault' },
    });

    expect(payload.payment_method).toBe('uba_redvault');
    expect(payload.discount_amount).toBe(0);
  });
});
