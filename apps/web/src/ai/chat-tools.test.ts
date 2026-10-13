import { describe, expect, it } from 'vitest';
import {
  addToCartSchema,
  cancelOrderSchema,
  checkPaymentStatusSchema,
  createVirtualAccountSchema,
  getProductDetailsSchema,
  getRecommendationsSchema,
  searchProductsSchema,
} from './chat-tools';

describe('searchProductsSchema', () => {
  it('validates a query-only input', () => {
    const result = searchProductsSchema.safeParse({ query: 'phone' });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ query: 'phone' });
  });

  it('rejects missing query', () => {
    const result = searchProductsSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('accepts optional filters', () => {
    const result = searchProductsSchema.safeParse({
      query: 'laptop',
      category: 'electronics',
      minPrice: 100000,
      maxPrice: 500000,
    });
    expect(result.success).toBe(true);
  });
});

describe('getProductDetailsSchema', () => {
  it('validates with productId', () => {
    const result = getProductDetailsSchema.safeParse({ productId: '123' });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ productId: '123' });
  });

  it('rejects missing productId', () => {
    const result = getProductDetailsSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe('addToCartSchema', () => {
  it('rejects a zero cart quantity', () => {
    const input = { productId: 'prod-1', quantity: 0 };

    const result = addToCartSchema.safeParse(input);

    expect(result.success).toBe(false);
  });

  it('rejects a fractional cart quantity', () => {
    const input = { productId: 'prod-1', quantity: 1.5 };

    const result = addToCartSchema.safeParse(input);

    expect(result.success).toBe(false);
  });

  it('rejects a cart quantity above the upper bound', () => {
    const input = { productId: 'prod-1', quantity: 100 };

    const result = addToCartSchema.safeParse(input);

    expect(result.success).toBe(false);
  });

  it('accepts the inclusive maximum cart quantity', () => {
    const input = { productId: 'prod-1', quantity: 99 };

    const result = addToCartSchema.safeParse(input);

    expect(result.success).toBe(true);
  });
});

describe('createVirtualAccountSchema', () => {
  it('validates full input', () => {
    const result = createVirtualAccountSchema.safeParse({
      email: 'test@example.com',
      amount: 50000,
      customerName: 'John Doe',
      customerEmail: 'test@example.com',
      customerPhone: '+2348012345678',
      items: [{ productId: 'p1', name: 'Phone', price: 50000, quantity: 1 }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid email', () => {
    const result = createVirtualAccountSchema.safeParse({
      amount: 50000,
      customerEmail: 'not-an-email',
      customerName: 'John Doe',
      items: [{ productId: 'p1', name: 'Phone', price: 50000, quantity: 1 }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing required fields', () => {
    const result = createVirtualAccountSchema.safeParse({
      amount: 50000,
    });
    expect(result.success).toBe(false);
  });
});

describe('checkPaymentStatusSchema', () => {
  it('validates with orderId', () => {
    const result = checkPaymentStatusSchema.safeParse({
      orderId: 'order-123',
    });
    expect(result.success).toBe(true);
  });

  it('validates with customerEmail', () => {
    const result = checkPaymentStatusSchema.safeParse({
      customerEmail: 'test@example.com',
    });
    expect(result.success).toBe(true);
  });

  it('rejects when neither orderId nor customerEmail is provided', () => {
    const result = checkPaymentStatusSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects invalid customerEmail', () => {
    const result = checkPaymentStatusSchema.safeParse({
      customerEmail: 'bad-email',
    });
    expect(result.success).toBe(false);
  });
});

describe('cancelOrderSchema', () => {
  it('validates with orderNumber and customerEmail', () => {
    const result = cancelOrderSchema.safeParse({
      orderNumber: '#00001234',
      customerEmail: 'BUYER@example.com',
    });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      orderNumber: '#00001234',
      customerEmail: 'buyer@example.com',
    });
  });

  it('validates with orderId and customerEmail', () => {
    const result = cancelOrderSchema.safeParse({
      orderId: '11111111-1111-4111-8111-111111111111',
      customerEmail: 'buyer@example.com',
    });
    expect(result.success).toBe(true);
  });

  it('rejects when neither orderId nor orderNumber is provided', () => {
    const result = cancelOrderSchema.safeParse({
      customerEmail: 'buyer@example.com',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid customerEmail', () => {
    const result = cancelOrderSchema.safeParse({
      orderNumber: 'ORD-123',
      customerEmail: 'bad-email',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid orderId format', () => {
    const result = cancelOrderSchema.safeParse({
      orderId: 'not-a-uuid',
      customerEmail: 'buyer@example.com',
    });
    expect(result.success).toBe(false);
  });

  it('rejects orderNumber values over 64 characters', () => {
    const result = cancelOrderSchema.safeParse({
      orderNumber: 'A'.repeat(65),
      customerEmail: 'buyer@example.com',
    });
    expect(result.success).toBe(false);
  });

  it('rejects whitespace-only order references', () => {
    const result = cancelOrderSchema.safeParse({
      orderNumber: '   ',
      customerEmail: 'buyer@example.com',
    });
    expect(result.success).toBe(false);
  });
});

describe('getRecommendationsSchema', () => {
  it('validates with upsell type', () => {
    const result = getRecommendationsSchema.safeParse({
      productId: 'prod-1',
      type: 'upsell',
    });
    expect(result.success).toBe(true);
  });

  it('validates with cross_sell type', () => {
    const result = getRecommendationsSchema.safeParse({
      productId: 'prod-1',
      type: 'cross_sell',
    });
    expect(result.success).toBe(true);
  });

  it('validates with accessories type', () => {
    const result = getRecommendationsSchema.safeParse({
      productId: 'prod-1',
      type: 'accessories',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid type enum value', () => {
    const result = getRecommendationsSchema.safeParse({
      productId: 'prod-1',
      type: 'invalid',
    });
    expect(result.success).toBe(false);
  });
});

describe('addToCartSchema', () => {
  it('validates with productId and defaults quantity to 1', () => {
    const result = addToCartSchema.safeParse({ productId: 'prod-1' });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ productId: 'prod-1', quantity: 1 });
  });

  it('accepts explicit quantity', () => {
    const result = addToCartSchema.safeParse({
      productId: 'prod-1',
      quantity: 3,
    });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ productId: 'prod-1', quantity: 3 });
  });

  it('rejects missing productId', () => {
    const result = addToCartSchema.safeParse({ quantity: 2 });
    expect(result.success).toBe(false);
  });
});
