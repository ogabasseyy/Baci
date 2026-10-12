import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { buildPiggyvestProvisioningRequest } from './provisioning-request';

const configuration = {
  environment: 'staging',
  integrationId: '44444444-4444-4444-8444-444444444444',
  expectedMerchantId: '11111111-1111-4111-8111-111111111111',
  expectedProjectId: 'synthetic-project',
  actualProjectId: 'synthetic-project',
  allowlistedCustomerIds: ['22222222-2222-4222-8222-222222222222'],
  provisioningApproved: true,
  syntheticIdentityApproved: true,
  defaultInterestRoutingVerified: true,
  fingerprintKey: 'synthetic-fingerprint-key-at-least-32-bytes',
  apiSecret: 'synthetic-provider-secret',
  expectedBusinessId: 'synthetic-business',
};
const command = {
  merchantId: configuration.expectedMerchantId,
  customerId: configuration.allowlistedCustomerIds[0],
  kind: 'create_customer',
  bvn: '00000000000',
  email: 'synthetic@example.test',
  name: 'Synthetic Customer',
  phone: '+2340000000000',
  enableInterestAccrual: false,
  interestPayout: 'own_wallet',
};

describe('buildPiggyvestProvisioningRequest', () => {
  it('does not assume omitted payout destination pays interest into the created wallet', () => {
    const unverified = Object.fromEntries(
      Object.entries(configuration).filter(
        ([key]) => key !== 'defaultInterestRoutingVerified'
      )
    );
    expect(() =>
      buildPiggyvestProvisioningRequest({
        configuration: unverified,
        command: { ...command, enableInterestAccrual: true },
      })
    ).toThrow('PiggyVest provisioning unavailable');
  });
  it('builds only documented customer fields and stable correlation', () => {
    const result = buildPiggyvestProvisioningRequest({
      configuration,
      command,
    });

    expect(result.path).toBe('/api/v1/customers');
    expect(JSON.parse(result.body)).toEqual({
      bvn: command.bvn,
      email: command.email,
      name: command.name,
      phone: command.phone,
      third_party_identifier: `baci:${configuration.integrationId}:${command.customerId}`,
      enable_interest_accrual: false,
    });
    expect(result.goalId).toBeNull();
    expect(result.requestFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(result.body).not.toContain(configuration.apiSecret);
  });

  it('builds a provider-safe unique dedicated plan wallet with explicit interest and account options', () => {
    const goalId = '33333333-3333-4333-8333-333333333333';
    const result = buildPiggyvestProvisioningRequest({
      configuration,
      command: {
        merchantId: command.merchantId,
        customerId: command.customerId,
        kind: 'create_plan_wallet',
        goalId,
        providerCustomerId: 'synthetic-customer',
        reserveVirtualAccount: true,
        enableInterestAccrual: true,
        interestPayout: 'own_wallet',
      },
    });

    expect(result.path).toBe('/api/v1/wallet/sub-account');
    const subaccountName = 'bacid4851b9412725e22e51c6197d9aa09fb57d36a59';
    expect(JSON.parse(result.body)).toEqual({
      subaccount_name: subaccountName,
      customer_id: 'synthetic-customer',
      reserve_virtual_account: true,
      enable_interest_accrual: true,
    });
    expect(subaccountName).toMatch(/^[a-z0-9]+$/);
    expect(subaccountName.length).toBeLessThanOrEqual(50);

    const differentGoal = buildPiggyvestProvisioningRequest({
      configuration,
      command: {
        merchantId: command.merchantId,
        customerId: command.customerId,
        kind: 'create_plan_wallet',
        goalId: '77777777-7777-4777-8777-777777777777',
        providerCustomerId: 'synthetic-customer',
        reserveVirtualAccount: true,
        enableInterestAccrual: true,
        interestPayout: 'own_wallet',
      },
    });
    expect(JSON.parse(differentGoal.body).subaccount_name).not.toBe(
      subaccountName
    );
    expect(result.goalId).toBe(goalId);
  });

  it('uses only the server-configured verified payout destination', () => {
    const result = buildPiggyvestProvisioningRequest({
      configuration: {
        ...configuration,
        verifiedInterestPayoutWalletId: 'synthetic-destination',
      },
      command: {
        ...command,
        enableInterestAccrual: true,
        interestPayout: 'configured_destination',
      },
    });
    expect(JSON.parse(result.body).interest_payout_wallet).toBe(
      'synthetic-destination'
    );
    expect(() =>
      buildPiggyvestProvisioningRequest({
        configuration,
        command: {
          ...command,
          interestPayout: 'configured_destination',
        },
      })
    ).toThrow('PiggyVest provisioning unavailable');
  });

  it.each([
    { environment: 'production' },
    { provisioningApproved: false },
    { syntheticIdentityApproved: false },
    { actualProjectId: 'other' },
    { expectedMerchantId: '55555555-5555-4555-8555-555555555555' },
    { allowlistedCustomerIds: [] },
    { fingerprintKey: 'short' },
    { apiBaseUrl: 'https://api.piggyvest.business' },
  ])('fails closed before building a request when staging authority is invalid', (change) => {
    expect(() =>
      buildPiggyvestProvisioningRequest({
        configuration: {
          ...configuration,
          ...change,
        },
        command,
      })
    ).toThrow('PiggyVest provisioning unavailable');
  });

  it('rejects an unallowlisted customer without including customer data in errors', () => {
    expect(() =>
      buildPiggyvestProvisioningRequest({
        configuration,
        command: {
          ...command,
          customerId: '66666666-6666-4666-8666-666666666666',
        },
      })
    ).toThrow(/^PiggyVest provisioning unavailable$/);
  });

  it('fingerprints canonical inputs consistently and binds interest choices and provider identity', () => {
    const first = buildPiggyvestProvisioningRequest({ configuration, command });
    const equivalent = buildPiggyvestProvisioningRequest({
      configuration,
      command: Object.fromEntries(Object.entries(command).reverse()),
    });
    const changed = buildPiggyvestProvisioningRequest({
      configuration,
      command: {
        ...command,
        enableInterestAccrual: true,
      },
    });
    const otherBusiness = buildPiggyvestProvisioningRequest({
      configuration: {
        ...configuration,
        expectedBusinessId: 'another-synthetic-business',
      },
      command,
    });

    expect(equivalent.requestFingerprint).toBe(first.requestFingerprint);
    expect(changed.requestFingerprint).not.toBe(first.requestFingerprint);
    expect(otherBusiness.requestFingerprint).not.toBe(first.requestFingerprint);
  });
});
