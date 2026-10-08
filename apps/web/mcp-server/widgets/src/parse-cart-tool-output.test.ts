import { describe, expect, it } from 'vitest';
import { parseCartToolOutput } from './parse-cart-tool-output';

const token = 'a'.repeat(64);
const cart_url = 'https://ogabassey.com/cart?guest_cart=%5B%5D';

describe('parseCartToolOutput', () => {
  it('accepts a full success response', () => {
    expect(
      parseCartToolOutput({ success: true, cart_token: token, cart_url })
    ).toEqual({ success: true, cart_token: token, cart_url });
  });

  it('accepts a bare failure response', () => {
    expect(parseCartToolOutput({ success: false })).toEqual({
      success: false,
    });
  });

  it('preserves the expired-cart recovery flag', () => {
    expect(
      parseCartToolOutput({ success: false, cart_expired: true })
    ).toEqual({ success: false, cart_expired: true });
    expect(parseCartToolOutput({ success: false, cart_expired: 1 })).toEqual({
      success: false,
    });
  });

  it('preserves quota-denial fields with a validated retry hint', () => {
    expect(
      parseCartToolOutput({
        success: false,
        quota_exceeded: true,
        retry_after_seconds: 1800,
      })
    ).toEqual({
      success: false,
      quota_exceeded: true,
      retry_after_seconds: 1800,
    });
    expect(
      parseCartToolOutput({
        success: false,
        quota_exceeded: true,
        retry_after_seconds: 'soon',
      })
    ).toEqual({ success: false, quota_exceeded: true });
    expect(
      parseCartToolOutput({ success: false, quota_exceeded: 1 })
    ).toEqual({ success: false });
  });

  it('preserves the variant-selection flag for replay triage', () => {
    expect(
      parseCartToolOutput({ success: false, requires_variant_selection: true })
    ).toEqual({ success: false, requires_variant_selection: true });
  });

  it('rejects non-record and non-boolean payloads', () => {
    for (const value of [null, undefined, 'bad', 42, [], { success: 'yes' }])
      expect(parseCartToolOutput(value)).toBeUndefined();
  });

  it('rejects success responses missing handoff fields', () => {
    expect(parseCartToolOutput({ success: true })).toBeUndefined();
    expect(
      parseCartToolOutput({ success: true, cart_token: token })
    ).toBeUndefined();
    expect(
      parseCartToolOutput({
        success: true,
        cart_token: 'too-short',
        cart_url,
      })
    ).toBeUndefined();
    expect(
      parseCartToolOutput({ success: true, cart_token: token, cart_url: 42 })
    ).toBeUndefined();
  });
});
