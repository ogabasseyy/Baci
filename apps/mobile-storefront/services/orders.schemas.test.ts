import { describe, expect, it } from '@jest/globals';
import { CreateOrderRequestSchema } from './orders.schemas';

const baseOrder = {
  customer_email: 'ada@example.com',
  customer_name: 'Ada Lovelace',
  customer_phone: '08012345678',
  items: [{ id: 'product-1', name: 'Widget', quantity: 1, price: 1000 }],
  subtotal: 1000,
  shipping_fee: 0,
  payment_method: 'paystack',
  shipping_address: {
    firstName: 'Ada',
    lastName: 'Lovelace',
    address: '1 Test Street',
    city: 'Lagos',
    state: 'Lagos',
  },
};

describe('CreateOrderRequestSchema delivery metadata', () => {
  it('accepts a local airport order with an airport type and no provider quote', () => {
    const result = CreateOrderRequestSchema.safeParse({
      ...baseOrder,
      delivery_method: 'airport',
      airport_type: 'delivery',
    });

    expect(result.success).toBe(true);
  });

  it('accepts a provider-backed airport order with a selected quote and no airport type', () => {
    const result = CreateOrderRequestSchema.safeParse({
      ...baseOrder,
      delivery_method: 'airport',
      selected_quote_id: '123e4567-e89b-42d3-a456-426614174000',
    });

    expect(result.success).toBe(true);
  });

  it('rejects an airport order without either local or provider metadata', () => {
    const result = CreateOrderRequestSchema.safeParse({
      ...baseOrder,
      delivery_method: 'airport',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: ['airport_type'],
            message: 'Airport type is required for local airport delivery',
          }),
        ])
      );
    }
  });

  it('rejects airport type metadata on non-airport orders', () => {
    const result = CreateOrderRequestSchema.safeParse({
      ...baseOrder,
      delivery_method: 'door',
      airport_type: 'delivery',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: ['airport_type'],
            message: 'Airport type is only valid for airport delivery',
          }),
        ])
      );
    }
  });

  it('keeps delivery metadata optional for non-airport orders', () => {
    const result = CreateOrderRequestSchema.safeParse({
      ...baseOrder,
      delivery_method: 'door',
    });

    expect(result.success).toBe(true);
  });
});

describe('CreateOrderRequestSchema REDVAULT credits', () => {
  it.each([
    { discount_amount: 1 },
    { wallet_amount: 1 },
    { savings_amount: 1 },
  ])('rejects serialized ordinary credit %o for REDVAULT', (credit) => {
    const result = CreateOrderRequestSchema.safeParse({
      ...baseOrder,
      ...credit,
      payment_method: 'uba_redvault',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: ['payment_method'],
            message:
              'UBA payment cannot be combined with other discounts or store credit',
          }),
        ])
      );
    }
  });

  it('accepts explicit zero-value ordinary credit fields for REDVAULT', () => {
    const result = CreateOrderRequestSchema.safeParse({
      ...baseOrder,
      payment_method: 'uba_redvault',
      discount_amount: 0,
      wallet_amount: 0,
    });

    expect(result.success).toBe(true);
  });
});
