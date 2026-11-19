import { describe, expect, it } from 'vitest';
import { merchantIdSchema } from './products-count';

describe('merchantIdSchema', () => {
  it('accepts a valid UUID', () => {
    expect(
      merchantIdSchema.safeParse('550e8400-e29b-41d4-a716-446655440000').success
    ).toBe(true);
  });

  it('rejects non-UUID merchant identifiers', () => {
    expect(merchantIdSchema.safeParse('not-a-uuid').success).toBe(false);
    expect(merchantIdSchema.safeParse('').success).toBe(false);
  });
});
