import { describe, expect, it } from 'vitest';
import { canonicalizeOutboxMetadataForGuard } from './order-notification-outbox-guard';

describe('order notification outbox guard', () => {
  it('canonicalizes guard metadata independent of key-insertion order', () => {
    expect(
      canonicalizeOutboxMetadataForGuard({ b: 2, a: { d: 4, c: 3 } })
    ).toBe('{"a":{"c":3,"d":4},"b":2}');
    // Array order is significant and preserved; undefined object values
    // serialize like JSON.stringify (dropped) instead of throwing.
    expect(
      canonicalizeOutboxMetadataForGuard({ list: [3, 1], skip: undefined })
    ).toBe('{"list":[3,1]}');
    expect(canonicalizeOutboxMetadataForGuard(null)).toBe('null');
    expect(canonicalizeOutboxMetadataForGuard('x')).toBe('"x"');
  });
});
