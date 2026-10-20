import { describe, expect, it } from 'vitest';
import {
  GuestCartBridgePendingError,
  GuestCartCanonicalError,
  GuestCartExpiredError,
  GuestCartMigratedError,
} from './guest-cart-errors';
import { mapGuestCartToolError } from './guest-cart-tool-responses';
import { withGuestCartTranscript } from './guest-cart-transcript';

const token = 'a'.repeat(64);

describe('withGuestCartTranscript', () => {
  it('leaves capability delivery unchanged unless the server explicitly opts in', () => {
    const original = mapGuestCartToolError(new GuestCartBridgePendingError(token));
    expect(withGuestCartTranscript(original)).toBe(original);
    expect(withGuestCartTranscript(original, { enabled: false })).toBe(original);
    expect(original.content).toHaveLength(1);
    expect(original.content[0].text).not.toContain(token);
  });

  it('allowlists continuation fields and excludes URLs, cart IDs and future fields', () => {
    const structuredContent = {
      success: true, cart_token: token, version: 2,
      items: [{ product_id: 'product', quantity: 1, futureCredential: 'secret' }],
      cart_url: 'https://ogabassey.com/cart#handoff=private',
      canonical_cart_id: 'canonical', migrated_cart_id: 'migrated', futureSecret: 'secret',
    };
    const result = withGuestCartTranscript({ content: [], structuredContent }, { enabled: true });
    expect(result.structuredContent).toBe(structuredContent);
    expect(JSON.parse(result.content.at(-1)?.text ?? 'null')).toEqual({
      success: true, cart_token: token, version: 2,
      items: [{ product_id: 'product', quantity: 1 }],
    });
  });

  it('omits retired authority while preserving the structured empty-cart response', () => {
    const structuredContent = { success: true, cart_token: token, cart_emptied: true, items: [] };
    const result = withGuestCartTranscript({ content: [], structuredContent }, { enabled: true });
    expect(result.structuredContent).toBe(structuredContent);
    expect(JSON.parse(result.content.at(-1)?.text ?? 'null')).toEqual({ success: true, cart_emptied: true, items: [] });
  });

  it('preserves the real bridge-pending recovery contract for an opted-in candidate', () => {
    const result = withGuestCartTranscript(
      mapGuestCartToolError(new GuestCartBridgePendingError(token)), { enabled: true }
    );
    expect(JSON.parse(result.content.at(-1)?.text ?? 'null')).toEqual({
      success: false, code: 'refresh_required', cart_token: token, retryable: true,
    });
  });

  it.each([
    { success: false }, // Invalid input and quota replies.
    mapGuestCartToolError(new GuestCartCanonicalError('unauthorized', token)).structuredContent,
    mapGuestCartToolError(new GuestCartExpiredError()).structuredContent,
    mapGuestCartToolError(new GuestCartMigratedError('canonical-cart')).structuredContent,
    { success: true, cart_emptied: true, items: [] },
  ])('keeps authority-free replies token-free in both content blocks: %j', (structuredContent) => {
    const original = { content: [{ type: 'text' as const, text: 'Summary' }], structuredContent };
    const result = withGuestCartTranscript(original, { enabled: true });
    expect(result.content).toHaveLength(2);
    expect(result.content[0]).toBe(original.content[0]);
    expect(JSON.stringify(result.content)).not.toContain(token);
    expect(JSON.stringify(result.content)).not.toContain('cart_token');
    expect(result.content[1]).toMatchObject({
      annotations: { audience: ['assistant'], priority: 1 },
    });
    expect(original.content).toHaveLength(1);
  });
});
