import { describe, expect, it } from 'vitest';
import { piggyvestSavingsPlanFundingQuerySchema } from './piggyvest-savings-plan-funding';

describe('piggyvestSavingsPlanFundingQuerySchema', () => {
  it('requires a goal and at least one merchant identifier', () => {
    expect(
      piggyvestSavingsPlanFundingQuerySchema.safeParse({
        goalId: '30000000-0000-4000-8000-000000000001',
        merchantSlug: 'synthetic-store',
      }).success
    ).toBe(true);
    expect(
      piggyvestSavingsPlanFundingQuerySchema.safeParse({
        goalId: '30000000-0000-4000-8000-000000000001',
      }).success
    ).toBe(false);
  });
});
