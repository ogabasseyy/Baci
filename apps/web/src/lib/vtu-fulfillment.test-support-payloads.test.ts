import { describe, expect, it } from 'vitest';
import { findPayloadWithMetadata } from './vtu-fulfillment.test-support-payloads';

describe('findPayloadWithMetadata', () => {
  it('returns the first payload whose metadata matches', () => {
    const payloads = [
      null,
      { status: 'processing' },
      { metadata: { refunded: false } },
      { metadata: { refunded: true, id: 'a' } },
      { metadata: { refunded: true, id: 'b' } },
    ];

    expect(
      findPayloadWithMetadata(
        payloads,
        (metadata) => metadata.refunded === true
      )
    ).toEqual({ metadata: { refunded: true, id: 'a' } });
  });

  it('returns undefined when no payload matches', () => {
    expect(
      findPayloadWithMetadata([{ metadata: null }, 'text'], () => true)
    ).toBeUndefined();
  });
});
