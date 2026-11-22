import { describe, expect, it } from 'vitest';
import {
  merchantInboxCustomerBadgeSchema,
  merchantInboxCustomerOrderSchema,
  merchantInboxCustomerProfileSchema,
} from './merchant-inbox-customer';

const order = {
  orderNumber: 'ORD-1',
  total: 50000,
  currency: 'NGN',
  paymentStatus: 'paid',
  shippingStatus: 'shipped',
  createdAt: '2026-11-20T10:00:00Z',
};

const profile = {
  name: 'Ada Obi',
  currency: 'NGN',
  memberSince: '2025-01-02T00:00:00Z',
  orderCount: 5,
  totalSpent: 412000,
  loyaltyPoints: 120,
  recentOrders: [order],
};

describe('merchantInboxCustomerBadgeSchema', () => {
  it('accepts a count and spend, including zero', () => {
    expect(
      merchantInboxCustomerBadgeSchema.safeParse({
        orderCount: 0,
        totalSpent: 0,
      }).success
    ).toBe(true);
  });

  it.each([
    ['a negative count', { orderCount: -1, totalSpent: 0 }],
    ['a fractional count', { orderCount: 1.5, totalSpent: 0 }],
    ['negative spend', { orderCount: 1, totalSpent: -5 }],
    ['a missing field', { orderCount: 1 }],
  ])('rejects %s', (_name, value) => {
    expect(merchantInboxCustomerBadgeSchema.safeParse(value).success).toBe(
      false
    );
  });
});

describe('merchantInboxCustomerOrderSchema', () => {
  it('accepts an order with or without a date', () => {
    expect(merchantInboxCustomerOrderSchema.safeParse(order).success).toBe(
      true
    );
    expect(
      merchantInboxCustomerOrderSchema.safeParse({ ...order, createdAt: null })
        .success
    ).toBe(true);
  });

  it.each([
    ['a two-letter currency', { ...order, currency: 'NG' }],
    ['a four-letter currency', { ...order, currency: 'NGNN' }],
    ['no currency', { ...order, currency: undefined }],
    ['an over-long order number', { ...order, orderNumber: 'x'.repeat(61) }],
    ['an over-long status', { ...order, paymentStatus: 'x'.repeat(41) }],
  ])('rejects %s', (_name, value) => {
    expect(merchantInboxCustomerOrderSchema.safeParse(value).success).toBe(
      false
    );
  });
});

describe('merchantInboxCustomerProfileSchema', () => {
  it('accepts a full profile and one with no orders or join date', () => {
    expect(merchantInboxCustomerProfileSchema.safeParse(profile).success).toBe(
      true
    );
    expect(
      merchantInboxCustomerProfileSchema.safeParse({
        ...profile,
        memberSince: null,
        recentOrders: [],
      }).success
    ).toBe(true);
  });

  it('allows five recent orders and refuses six', () => {
    expect(
      merchantInboxCustomerProfileSchema.safeParse({
        ...profile,
        recentOrders: Array.from({ length: 5 }, () => order),
      }).success
    ).toBe(true);
    expect(
      merchantInboxCustomerProfileSchema.safeParse({
        ...profile,
        recentOrders: Array.from({ length: 6 }, () => order),
      }).success
    ).toBe(false);
  });

  it.each([
    ['negative spend', { totalSpent: -1 }],
    ['a negative order count', { orderCount: -2 }],
    ['fractional loyalty points', { loyaltyPoints: 1.2 }],
    ['an over-long name', { name: 'n'.repeat(121) }],
    ['a bad store currency', { currency: 'naira' }],
  ])('rejects %s', (_name, change) => {
    expect(
      merchantInboxCustomerProfileSchema.safeParse({ ...profile, ...change })
        .success
    ).toBe(false);
  });
});
