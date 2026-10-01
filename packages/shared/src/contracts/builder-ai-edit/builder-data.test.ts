import { describe, expect, it } from 'vitest';
import { builderDataSchema } from './builder-data';

describe('builderDataSchema', () => {
  it('preserves supported builder collections and requires root data', () => {
    expect(
      builderDataSchema.safeParse({
        content: [],
        root: { title: 'Home' },
        zones: { aside: [] },
      }).success
    ).toBe(true);
    expect(builderDataSchema.safeParse({ content: [] }).success).toBe(false);
  });
});
