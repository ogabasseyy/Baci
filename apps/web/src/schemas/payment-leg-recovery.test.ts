import { describe, expect, it } from 'vitest';
import { paymentLegRecoverySchemas } from './payment-leg-recovery';

const uuid = '00000000-0000-4000-8000-000000000000';

describe('paymentLegRecoverySchemas', () => {
  it('accepts a valid observation', () => {
    expect(
      paymentLegRecoverySchemas.observation.safeParse({
        operationId: uuid,
        leg: 'savings',
        reason: 'contract_unconfirmed',
      }).success
    ).toBe(true);
  });

  it('rejects an unknown leg', () => {
    expect(
      paymentLegRecoverySchemas.observation.safeParse({
        operationId: uuid,
        leg: 'interest',
        reason: 'contract_unconfirmed',
      }).success
    ).toBe(false);
  });

  it('defaults a missing observation id in lookups', () => {
    expect(
      paymentLegRecoverySchemas.lookup.parse({ operationId: uuid })
    ).toEqual({ operationId: uuid, observationId: null });
  });

  it('requires exactly one result row', () => {
    expect(paymentLegRecoverySchemas.rows.safeParse([]).success).toBe(false);
  });
});
