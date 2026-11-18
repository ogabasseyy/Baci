import { describe, expect, it } from 'vitest';
import { oxygenPlanQuoteSchema } from './plan';

const quote = {
  workflowId: '690a9d2e-33b7-4106-8c68-b9019f814dce',
  idempotencyKey: 'a9f18aad-483d-4a0e-9175-51d2a5d8a80f',
  equityPercentage: 25,
  tenure: 3,
};

describe('Oxygen plan quote', () => {
  it('accepts supported terms', () => {
    expect(oxygenPlanQuoteSchema.safeParse(quote).success).toBe(true);
  });
  it('rejects invalid down payments, tenure and extra fields', () => {
    for (const input of [
      { ...quote, equityPercentage: 24 },
      { ...quote, equityPercentage: 25.123 },
      { ...quote, tenure: 13 },
      { ...quote, extra: true },
    ])
      expect(oxygenPlanQuoteSchema.safeParse(input).success).toBe(false);
  });
});
