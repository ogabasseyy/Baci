import { describe, expect, it } from 'vitest';
import { piggyvestProvisioningCommandSchema } from './piggyvest-provisioning-command';

const identity = {
  merchantId: '11111111-1111-4111-8111-111111111111',
  customerId: '22222222-2222-4222-8222-222222222222',
  enableInterestAccrual: true,
  interestPayout: 'own_wallet',
};
const customer = {
  ...identity,
  kind: 'create_customer',
  bvn: '00000000000',
  email: 'synthetic@example.test',
  name: 'Synthetic Customer',
  phone: '+2340000000000',
};
const wallet = {
  ...identity,
  kind: 'create_plan_wallet',
  goalId: '33333333-3333-4333-8333-333333333333',
  providerCustomerId: 'synthetic-provider-customer',
  reserveVirtualAccount: true,
};

describe('piggyvestProvisioningCommandSchema', () => {
  it.each([
    customer,
    wallet,
    { ...wallet, customerName: 'Bassey Effiong' },
  ])('accepts a complete explicit provisioning command', (input) => {
    expect(piggyvestProvisioningCommandSchema.safeParse(input).success).toBe(
      true
    );
  });

  it.each([
    '',
    '0000000000',
    '000000000000',
    '0000000000a',
    0,
  ])('rejects malformed mandatory BVN without coercion', (bvn) => {
    expect(
      piggyvestProvisioningCommandSchema.safeParse({ ...customer, bvn }).success
    ).toBe(false);
  });

  it.each([
    { enableInterestAccrual: undefined },
    { interestPayout: undefined },
    { interestPayout: 'unverified-wallet' },
    { merchantId: 'other' },
    { customerId: null },
    { email: 'not-an-email' },
    { name: 'Synthetic\u0000Customer' },
    { name: '\ud800' },
    { phone: ' ' },
    { bypass_withdrawal_limit_rule: true },
    { interest_payout_wallet: 'body-selected-wallet' },
    { balance: 1000 },
  ])('rejects incomplete configuration and authority-expanding fields', (change) => {
    expect(
      piggyvestProvisioningCommandSchema.safeParse({ ...customer, ...change })
        .success
    ).toBe(false);
  });

  it.each([
    { goalId: undefined },
    { providerCustomerId: '' },
    { reserveVirtualAccount: undefined },
    { reserveVirtualAccount: 'true' },
    { subaccount_name: 'user-selected-name' },
    { customerName: '' },
    { customerName: ' ' },
    { customerName: 'Bassey\u0000Effiong' },
    { customerName: '\ud800' },
    { customerName: 'A'.repeat(513) },
  ])('rejects incomplete or noncanonical plan wallet commands', (change) => {
    expect(
      piggyvestProvisioningCommandSchema.safeParse({ ...wallet, ...change })
        .success
    ).toBe(false);
  });
});
