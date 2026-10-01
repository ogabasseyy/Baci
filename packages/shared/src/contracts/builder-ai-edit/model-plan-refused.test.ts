import { describe, expect, it } from 'vitest';
import { builderAiRefusedPlanSchema } from './model-plan-refused';

describe('builderAiRefusedPlanSchema', () => {
  it('accepts only a bounded refusal with no operations', () => {
    expect(
      builderAiRefusedPlanSchema.safeParse({
        operations: [],
        reason: 'Unsupported request',
        status: 'refused',
      }).success
    ).toBe(true);
    expect(
      builderAiRefusedPlanSchema.safeParse({
        operations: [{ kind: 'update_root', title: 'No' }],
        reason: 'Unsupported request',
        status: 'refused',
      }).success
    ).toBe(false);
  });
});
