import { describe, expect, it } from 'vitest';
import { withGuestCartTranscript } from './guest-cart-transcript';

const token = 'a'.repeat(64);

describe('withGuestCartTranscript', () => {
  it.each([
    { success: true, cart_token: token, version: 2, items: [] },
    { success: false }, // Invalid input and quota replies.
    { success: false, code: 'unauthorized' },
    { success: false, code: 'cart_migrated' },
    { success: false, code: 'bridge_pending', cart_token: token },
    { success: false, code: 'version_conflict', cart_token: token, version: 3 },
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
