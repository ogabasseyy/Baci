import { describe, expect, it } from 'vitest';
import { orderCreateSchema } from './orders';

const validOrder = {
  merchant_id: '123e4567-e89b-12d3-a456-426614174000',
  customer_email: 'test@example.com',
  customer_name: 'John Doe',
  customer_phone: '+234 800 123 4567',
  items: [
    {
      name: 'Test Product',
      quantity: 1,
      price: 1000,
      productId: 'prod-1',
    },
  ],
  subtotal: 1000,
  payment_method: 'card',
};

describe('orderCreateSchema delivery metadata', () => {
  it.each([
    ['airport', 'airport'],
    ['door', 'door'],
    ['pickup_station', 'pickup_station'],
  ] as const)('accepts %s delivery metadata', (deliveryMethod, expectedMethod) => {
    const result = orderCreateSchema.safeParse({
      ...validOrder,
      airport_type: deliveryMethod === 'airport' ? 'delivery' : undefined,
      delivery_method: deliveryMethod,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.delivery_method).toBe(expectedMethod);
    }
  });

  it('accepts airport pickup metadata', () => {
    expect(
      orderCreateSchema.safeParse({
        ...validOrder,
        airport_type: 'pickup',
        delivery_method: 'airport',
      }).success
    ).toBe(true);
  });

  it('rejects a local airport order without airport_type', () => {
    expect(
      orderCreateSchema.safeParse({
        ...validOrder,
        delivery_method: 'airport',
      }).success
    ).toBe(false);
  });

  it('allows a provider-backed airport order without airport_type', () => {
    expect(
      orderCreateSchema.safeParse({
        ...validOrder,
        delivery_method: 'airport',
        selected_quote_id: '123e4567-e89b-12d3-a456-426614174777',
      }).success
    ).toBe(true);
  });

  it('rejects airport_type on non-airport delivery methods', () => {
    expect(
      orderCreateSchema.safeParse({
        ...validOrder,
        airport_type: 'delivery',
        delivery_method: 'door',
      }).success
    ).toBe(false);
  });

  it('rejects invalid delivery metadata enum values', () => {
    expect(
      orderCreateSchema.safeParse({
        ...validOrder,
        airport_type: 'domestic',
        delivery_method: 'flight',
      }).success
    ).toBe(false);
  });
});
