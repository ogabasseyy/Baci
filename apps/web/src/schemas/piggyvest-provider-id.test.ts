import { describe, expect, it } from 'vitest';
import { piggyvestProviderIdSchema } from './piggyvest-provider-id';

describe('piggyvestProviderIdSchema', () => {
  it.each([
    'synthetic-event',
    'é'.repeat(256),
  ])('accepts bounded opaque event identity', (value) => {
    expect(piggyvestProviderIdSchema.safeParse(value).success).toBe(true);
  });
  it.each([
    '',
    'é'.repeat(257),
    '\0',
    '\ud800',
    'x'.repeat(513),
  ])('rejects IDs that cannot be persisted unchanged', (value) => {
    expect(piggyvestProviderIdSchema.safeParse(value).success).toBe(false);
  });
});
