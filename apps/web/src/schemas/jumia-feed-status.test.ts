import { describe, expect, it } from 'vitest';
import { jumiaFeedStatusQuerySchema } from './jumia-feed-status';

describe('jumiaFeedStatusQuerySchema', () => {
  it('accepts a valid integration id', () => {
    expect(
      jumiaFeedStatusQuerySchema.safeParse({
        integrationId: '00000000-0000-4000-8000-000000000099',
      }).success
    ).toBe(true);
  });

  it('rejects a malformed integration id', () => {
    expect(
      jumiaFeedStatusQuerySchema.safeParse({ integrationId: 'bad' }).success
    ).toBe(false);
  });
});
