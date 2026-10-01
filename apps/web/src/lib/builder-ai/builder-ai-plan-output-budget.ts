export const builderAiPlanOutputBudget = {
  // Provider output tokens are an independent transport ceiling; the shared
  // aggregate plan byte cap is enforced separately after structured parsing.
  maxOutputTokens: 6_144,
  isApproved: (value: unknown): value is number => value === 6_144,
  routeResponseMarginMs: 1_000,
};
