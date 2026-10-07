import { describe, expect, it } from 'vitest';
import { piggyvestInboxEnqueueSchemas } from './piggyvest-inbox-enqueue';

const input = {
  integrationId: '00000000-0000-4000-8000-000000000001',
  eventId: 'synthetic-event',
  rawPayload: new Uint8Array([1]),
};

describe('piggyvestInboxEnqueueSchemas', () => {
  it('accepts bounded staging persistence input', () => {
    expect(piggyvestInboxEnqueueSchemas.input.safeParse(input).success).toBe(
      true
    );
  });

  it.each([
    { integrationId: 'invalid' },
    { eventId: '' },
    { eventId: 'é'.repeat(257) },
    { rawPayload: 'not-bytes' },
    { rawPayload: new Uint8Array() },
    { rawPayload: new Uint8Array(65537) },
    { merchantId: 'untrusted' },
  ])('rejects invalid persistence input before database work', (override) => {
    expect(
      piggyvestInboxEnqueueSchemas.input.safeParse({ ...input, ...override })
        .success
    ).toBe(false);
  });

  it('accepts exactly the event identity byte limit', () => {
    expect(
      piggyvestInboxEnqueueSchemas.input.safeParse({
        ...input,
        eventId: 'é'.repeat(256),
      }).success
    ).toBe(true);
  });
});
