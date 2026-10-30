import { expect, it } from 'vitest';
import { redvaultRecoveryCustomerSchema } from './redvault-recovery-customer';

it('requires all original order customer fields', () => {
  expect(
    redvaultRecoveryCustomerSchema.safeParse({
      customer_email: 'ada@example.test',
      customer_name: 'Ada',
      customer_phone: '08012345678',
    }).success
  ).toBe(true);
  expect(
    redvaultRecoveryCustomerSchema.safeParse({
      customer_email: 'ada@example.test',
    }).success
  ).toBe(false);
});
