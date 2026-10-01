import { describe, expect, it } from 'vitest';
import { builderAiProposedPlanSchema } from './model-plan-proposed';

describe('builderAiProposedPlanSchema', () => {
  it('requires a non-empty bounded proposed operation list', () => {
    expect(
      builderAiProposedPlanSchema.safeParse({
        operations: [{ kind: 'update_root', title: 'New title' }],
        status: 'proposed',
        summary: 'Update the title',
      }).success
    ).toBe(true);
    expect(
      builderAiProposedPlanSchema.safeParse({
        operations: [],
        status: 'proposed',
        summary: 'Nothing',
      }).success
    ).toBe(false);
  });
});
