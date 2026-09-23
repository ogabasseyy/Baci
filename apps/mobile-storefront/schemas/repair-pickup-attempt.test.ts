import { repairPickupAttemptSchema } from './repair-pickup-attempt';

it('requires a UUID and a positive agreed price for a persisted attempt', () => {
  expect(
    repairPickupAttemptSchema.safeParse({
      requestId: '14bf2192-16de-442b-bf75-700f4ff2aaca',
      expectedPickupFee: 3000,
    }).success
  ).toBe(true);
  expect(
    repairPickupAttemptSchema.safeParse({
      requestId: 'bad',
      expectedPickupFee: -1,
    }).success
  ).toBe(false);
});
