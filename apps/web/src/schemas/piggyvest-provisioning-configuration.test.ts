import { describe, expect, it } from 'vitest';
import { piggyvestProvisioningConfigurationSchema } from './piggyvest-provisioning-configuration';

const configuration = {
  environment: 'staging',
  integrationId: '11111111-1111-4111-8111-111111111111',
  expectedMerchantId: '22222222-2222-4222-8222-222222222222',
  expectedProjectId: 'synthetic-project',
  actualProjectId: 'synthetic-project',
  allowlistedCustomerIds: ['33333333-3333-4333-8333-333333333333'],
  provisioningApproved: true,
  syntheticIdentityApproved: true,
  apiSecret: 'synthetic-api-secret',
  expectedBusinessId: 'synthetic-business',
  fingerprintKey: 'synthetic-hmac-fingerprint-key-32-bytes',
};

describe('piggyvestProvisioningConfigurationSchema', () => {
  it('accepts explicit isolated staging configuration', () => {
    expect(
      piggyvestProvisioningConfigurationSchema.safeParse(configuration).success
    ).toBe(true);
  });

  it.each([
    { environment: undefined },
    { environment: 'production' },
    { expectedCurrency: 'USD' },
    { integrationId: 'invalid' },
    { expectedMerchantId: 'invalid' },
    { expectedProjectId: '' },
    { actualProjectId: 'different-project' },
    { provisioningApproved: undefined },
    { syntheticIdentityApproved: undefined },
    { allowlistedCustomerIds: [] },
    { allowlistedCustomerIds: ['invalid'] },
    {
      allowlistedCustomerIds: Array(21).fill(
        configuration.allowlistedCustomerIds[0]
      ),
    },
    { fingerprintKey: 'short' },
    { fingerprintKey: 'a'.repeat(513) },
    { apiBaseUrl: 'https://api.piggyvest.business' },
    { verifiedInterestPayoutWalletId: '' },
    { arbitraryFlag: true },
  ])('rejects missing gates, invalid isolation and unrecognized options', (change) => {
    expect(
      piggyvestProvisioningConfigurationSchema.safeParse({
        ...configuration,
        ...change,
      }).success
    ).toBe(false);
  });
});
