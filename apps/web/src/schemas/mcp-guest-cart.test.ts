import { describe, expect, it } from 'vitest';
import {
  guestCartHandoffSchema,
  guestCartLineSchema,
  mcpGuestCartInputSchema,
  mcpGuestCartOutputSchema,
} from './mcp-guest-cart';

const id = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const token = 'a'.repeat(64);

describe('guestCartLineSchema', () => {
  it('parses a valid line', () => {
    expect(
      guestCartLineSchema.safeParse({ product_id: id, quantity: 2 }).success
    ).toBe(true);
  });

  it('rejects a non-uuid product id', () => {
    expect(
      guestCartLineSchema.safeParse({ product_id: 'not-a-uuid', quantity: 2 })
        .success
    ).toBe(false);
  });

  it.each([1, 10])('accepts boundary quantity %i', (quantity) => {
    expect(
      guestCartLineSchema.safeParse({ product_id: id, quantity }).success
    ).toBe(true);
  });

  it.each([0, 11, 2.5])('rejects out-of-range quantity %s', (quantity) => {
    expect(
      guestCartLineSchema.safeParse({ product_id: id, quantity }).success
    ).toBe(false);
  });
});

describe('guestCartHandoffSchema', () => {
  it('parses a valid handoff', () => {
    expect(
      guestCartHandoffSchema.safeParse([
        { product_id: id, quantity: 2 },
        { product_id: other, quantity: 1 },
      ]).success
    ).toBe(true);
  });

  it('rejects an empty handoff', () => {
    expect(guestCartHandoffSchema.safeParse([]).success).toBe(false);
  });

  it('rejects more than 20 lines', () => {
    const items = Array.from({ length: 21 }, (_, index) => ({
      product_id: `33333333-3333-4333-8333-${index.toString(16).padStart(12, '0')}`,
      quantity: 1,
    }));
    expect(guestCartHandoffSchema.safeParse(items).success).toBe(false);
  });

  it('rejects duplicate product ids', () => {
    expect(
      guestCartHandoffSchema.safeParse([
        { product_id: id, quantity: 1 },
        { product_id: id, quantity: 2 },
      ]).success
    ).toBe(false);
  });

  it('rejects duplicates that differ only by case', () => {
    expect(
      guestCartHandoffSchema.safeParse([
        { product_id: id.toUpperCase(), quantity: 1 },
        { product_id: id, quantity: 2 },
      ]).success
    ).toBe(false);
  });
});

describe('mcpGuestCartInputSchema', () => {
  it('defaults an omitted quantity to 1', () => {
    const result = mcpGuestCartInputSchema.safeParse({ product_id: id });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.quantity).toBe(1);
  });

  it('accepts quantity 0 as a removal', () => {
    const result = mcpGuestCartInputSchema.safeParse({
      product_id: id,
      quantity: 0,
      cart_token: token,
    });
    expect(result.success).toBe(true);
  });

  it('rejects quantity above 10', () => {
    expect(
      mcpGuestCartInputSchema.safeParse({ product_id: id, quantity: 11 })
        .success
    ).toBe(false);
  });

  it('rejects a malformed cart token', () => {
    expect(
      mcpGuestCartInputSchema.safeParse({
        product_id: id,
        quantity: 1,
        cart_token: 'too-short',
      }).success
    ).toBe(false);
  });
});

describe('mcpGuestCartOutputSchema', () => {
  it('parses a minimal failure payload', () => {
    expect(mcpGuestCartOutputSchema.safeParse({ success: false }).success).toBe(
      true
    );
  });

  it('parses a full success payload', () => {
    const result = mcpGuestCartOutputSchema.safeParse({
      success: true,
      cart_token: token,
      items: [{ product_id: id, quantity: 2 }],
      expires_at: new Date('2026-10-14T00:00:00.000Z').toISOString(),
      cart_url: 'https://ogabassey.com/cart?guest_cart=%5B%5D',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a success payload missing handoff fields', () => {
    expect(mcpGuestCartOutputSchema.safeParse({ success: true }).success).toBe(
      false
    );
    expect(
      mcpGuestCartOutputSchema.safeParse({
        success: true,
        cart_token: token,
        items: [{ product_id: id, quantity: 2 }],
      }).success
    ).toBe(false);
  });

  it('rejects a non-boolean success discriminator', () => {
    expect(mcpGuestCartOutputSchema.safeParse({ success: 'yes' }).success).toBe(
      false
    );
  });

  it('parses a variant-selection payload', () => {
    const result = mcpGuestCartOutputSchema.safeParse({
      success: false,
      requires_variant_selection: true,
      product_id: id,
      product_url: 'https://ogabassey.com/products/slug',
    });
    expect(result.success).toBe(true);
  });

  it('parses an expired-cart recovery flag', () => {
    const result = mcpGuestCartOutputSchema.safeParse({
      success: false,
      cart_expired: true,
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid token, oversized items, datetime, and url fields', () => {
    const base = {
      success: true,
      cart_token: token,
      items: [{ product_id: id, quantity: 2 }],
      expires_at: new Date('2026-10-14T00:00:00.000Z').toISOString(),
      cart_url: 'https://ogabassey.com/cart',
    };
    expect(
      mcpGuestCartOutputSchema.safeParse({ ...base, cart_token: 'bad' }).success
    ).toBe(false);
    expect(
      mcpGuestCartOutputSchema.safeParse({
        ...base,
        items: Array.from({ length: 21 }, () => ({
          product_id: id,
          quantity: 1,
        })),
      }).success
    ).toBe(false);
    expect(
      mcpGuestCartOutputSchema.safeParse({ ...base, expires_at: 'tomorrow' })
        .success
    ).toBe(false);
    expect(
      mcpGuestCartOutputSchema.safeParse({ ...base, cart_url: 'not a url' })
        .success
    ).toBe(false);
  });
});
