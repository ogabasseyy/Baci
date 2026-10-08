import { describe, expect, it } from 'vitest';
import {
  mcpGuestCartInputSchema,
  mcpGuestCartOutputSchema,
} from './mcp-guest-cart';

const id = '11111111-1111-4111-8111-111111111111';
const token = 'a'.repeat(64);

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

  it('rejects quantity 0 without a cart token', () => {
    const result = mcpGuestCartInputSchema.safeParse({
      product_id: id,
      quantity: 0,
    });
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues[0]).toMatchObject({
        path: ['cart_token'],
      });
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

  it('parses an emptied-cart payload without stripping its flag', () => {
    const result = mcpGuestCartOutputSchema.safeParse({
      success: true,
      cart_token: 'a'.repeat(64),
      items: [],
      expires_at: new Date().toISOString(),
      cart_url: 'https://ogabassey.com/cart',
      cart_emptied: true,
    });
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ cart_emptied: true });
  });

  it('parses an unavailable-product payload without stripping its flag', () => {
    const result = mcpGuestCartOutputSchema.safeParse({
      success: false,
      product_unavailable: true,
      product_id: id,
    });
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ product_unavailable: true });
  });

  it('parses a full-cart payload without stripping its flag', () => {
    const result = mcpGuestCartOutputSchema.safeParse({
      success: false,
      cart_full: true,
    });
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ cart_full: true });
  });

  it('parses a quota-denial payload without stripping its flags', () => {
    const result = mcpGuestCartOutputSchema.safeParse({
      success: false,
      quota_exceeded: true,
      retry_after_seconds: 1800,
    });
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      quota_exceeded: true,
      retry_after_seconds: 1800,
    });
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
