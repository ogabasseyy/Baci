import { describe, expect, it } from 'vitest';
import { piggyvestPlanIdentifiersSchema } from './piggyvest-plan';

describe('piggyvestPlanIdentifiersSchema', () => {
  it('accepts a merchant id', () => {
    expect(
      piggyvestPlanIdentifiersSchema.safeParse({
        merchantId: '00000000-0000-4000-8000-000000000000',
      }).success
    ).toBe(true);
  });

  it('accepts a merchant slug', () => {
    expect(
      piggyvestPlanIdentifiersSchema.safeParse({ merchantSlug: 'acme' }).success
    ).toBe(true);
  });

  it('rejects an empty identifier set', () => {
    expect(piggyvestPlanIdentifiersSchema.safeParse({}).success).toBe(false);
  });
});
