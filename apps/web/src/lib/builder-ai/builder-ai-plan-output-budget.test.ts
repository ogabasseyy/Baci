import { describe, expect, it } from 'vitest';
import { builderAiPlanOutputBudget } from './builder-ai-plan-output-budget';

describe('builder AI plan output budget', () => {
  it('uses the shared 6,144-token cap rather than a null or synthetic character bound', () => {
    expect(builderAiPlanOutputBudget.maxOutputTokens).toBe(6_144);
    expect(builderAiPlanOutputBudget.maxOutputTokens).not.toBeNull();
    expect(builderAiPlanOutputBudget.maxOutputTokens).not.toBe(1_341_756);
  });

  it.each([
    null,
    1_341_756,
  ])('rejects the obsolete output budget %s', (value) => {
    expect(builderAiPlanOutputBudget.isApproved(value)).toBe(false);
  });

  it('reserves response serialization time outside provider execution', () => {
    expect(builderAiPlanOutputBudget.routeResponseMarginMs).toBeGreaterThan(0);
  });
});
