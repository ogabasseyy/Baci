import { expect, it } from 'vitest';
import { paymentLegRecoverySchemas } from '@/schemas/payment-leg-recovery';
import { paymentLegRecoveryFixture } from './payment-leg-recovery.fixture';

it('supplies coherent synthetic intent-derived metadata without financial authority', () => {
  const fixture = paymentLegRecoveryFixture();
  expect(paymentLegRecoverySchemas.result.parse(fixture.result)).toEqual(
    fixture.result
  );
  expect(
    paymentLegRecoverySchemas.result.safeParse({
      ...fixture.result,
      savingsKobo: 999,
    }).success
  ).toBe(false);
});
