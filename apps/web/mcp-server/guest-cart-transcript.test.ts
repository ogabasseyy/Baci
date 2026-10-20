import { describe, expect, it } from 'vitest';
import {
  GuestCartBridgePendingError,
  GuestCartCanonicalError,
  GuestCartMigratedError,
} from './guest-cart-errors';
import { mapGuestCartToolError } from './guest-cart-tool-responses';
import { withGuestCartTranscript } from './guest-cart-transcript';

const token = 'a'.repeat(64);

describe('withGuestCartTranscript', () => {
  it('preserves the real bridge-pending recovery contract', () => {
    const result = withGuestCartTranscript(
      mapGuestCartToolError(new GuestCartBridgePendingError(token))
    );
    expect(JSON.parse(result.content.at(-1)?.text ?? 'null')).toEqual({
      success: false,
      code: 'refresh_required',
      cart_token: token,
      retryable: true,
    });
  });

  it.each([
    { success: true, cart_token: token, version: 2, items: [] },
    { success: false }, // Invalid input and quota replies.
    mapGuestCartToolError(new GuestCartCanonicalError('unauthorized', token)).structuredContent,
    mapGuestCartToolError(new GuestCartMigratedError('canonical-cart')).structuredContent,
    mapGuestCartToolError(new GuestCartBridgePendingError(token)).structuredContent,
    mapGuestCartToolError(
      new GuestCartCanonicalError('version_conflict', token, 'canonical-cart', 3)
    ).structuredContent,
    { success: true, cart_emptied: true, items: [] },
  ])('preserves the structured capability contract: %j', (structuredContent) => {
    const original = {
      content: [{ type: 'text' as const, text: 'Shopper-facing summary' }],
      structuredContent,
    };
    const result = withGuestCartTranscript(original);
    expect(result.structuredContent).toBe(structuredContent);
    expect(result.content[0]).toBe(original.content[0]);
    expect(result.content).toHaveLength(2);
    const transcript = result.content[1];
    expect(transcript).toMatchObject({
      type: 'text',
      annotations: { audience: ['assistant'], priority: 1 },
    });
    expect(JSON.parse(transcript.text)).toEqual(structuredContent);
    if (!('cart_token' in structuredContent)) {
      expect(transcript.text).not.toContain('cart_token');
      expect(transcript.text).not.toContain(token);
    }
    expect(original.content).toHaveLength(1);
  });
});
