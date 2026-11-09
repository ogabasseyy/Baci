import { expect, it } from 'vitest';
import { oxygenAddressRecoverySchema } from './oxygen-address-recovery';

const value = {
  workflowId: '60000000-0000-4000-8000-000000000001',
  version: 0,
  idempotencyKey: '70000000-0000-4000-8000-000000000001',
  bookingReference: '80000000-0000-4000-8000-000000000001',
};
it('requires an exact workflow, booking and command binding', () => {
  expect(oxygenAddressRecoverySchema.safeParse(value).success).toBe(true);
  for (const invalid of [
    { ...value, bookingReference: '' },
    { ...value, version: -1 },
    { ...value, idempotencyKey: null },
    { ...value, extra: true },
  ])
    expect(oxygenAddressRecoverySchema.safeParse(invalid).success).toBe(false);
});
