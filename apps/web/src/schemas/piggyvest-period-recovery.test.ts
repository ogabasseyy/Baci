import { expect, it } from 'vitest';
import { piggyvestPeriodRecoverySchemas as schemas } from './piggyvest-period-recovery';

const ledgerOperationId = 'a0000000-0000-4000-8000-000000000001';
it('accepts only an existing canonical operation identity', () => {
  expect(schemas.command.parse({ ledgerOperationId })).toEqual({
    ledgerOperationId,
  });
});
it.each([
  'amountKobo',
  'period',
  'paid',
  'entitled',
  'providerPayoutId',
  'disposition',
])('rejects caller financial authority %s', (key) => {
  expect(
    schemas.command.safeParse({ ledgerOperationId, [key]: true }).success
  ).toBe(false);
});
