import { describe, expect, it } from 'vitest';
import { piggyvestCustomerPolicyContextSchemas as schemas } from './piggyvest-customer-policy-context';

const merchantId = 'abcdefab-1111-4111-8111-111111111111';
const configuration = {
  environment: 'staging',
  transport: 'local_test',
  integrationId: merchantId,
  merchantId,
  expectedBusinessId: 'synthetic-business',
  allowlistedMerchantIds: [merchantId],
  allowlistedCustomerIds: [merchantId],
  expectedProjectId: 'synthetic',
  actualProjectId: 'synthetic',
};

describe('customer policy context schemas', () => {
  it('canonicalizes UUIDs before allowlist comparison', () => {
    expect(
      schemas.configuration.parse({
        ...configuration,
        merchantId: merchantId.toUpperCase(),
      }).merchantId
    ).toBe(merchantId);
    expect(schemas.input.parse({ goalId: merchantId.toUpperCase() })).toEqual({
      goalId: merchantId,
    });
  });
  it.each([
    { allowlistedCustomerIds: undefined },
    { allowlistedCustomerIds: [] },
    { allowlistedCustomerIds: ['invalid'] },
    { allowlistedCustomerIds: Array(21).fill(merchantId) },
    { environment: 'production' },
    { transport: undefined },
    { transport: 'tls' },
    { expectedProjectId: '' },
    { actualProjectId: 'other' },
    { integrationId: 'bad' },
    { expectedBusinessId: '' },
    { allowlistedMerchantIds: [] },
    { allowlistedMerchantIds: Array(21).fill(merchantId) },
    { actorId: merchantId },
  ])('rejects invalid or implicit config %j', (change) => {
    expect(
      schemas.configuration.safeParse({ ...configuration, ...change }).success
    ).toBe(false);
  });
  it.each([
    {},
    { goalId: 'bad' },
    { goalId: merchantId, customerId: merchantId },
    { goalId: merchantId, merchantId },
  ])('only accepts strict goal UUID input %j', (input) => {
    expect(schemas.input.safeParse(input).success).toBe(false);
  });
  it('rejects unlinked customer rows and unexpected projection data', () => {
    expect(
      schemas.customer.safeParse({
        id: merchantId,
        merchant_id: merchantId,
        user_id: null,
      }).success
    ).toBe(false);
    expect(
      schemas.goal.safeParse({
        id: merchantId,
        merchant_id: merchantId,
        customer_id: merchantId,
        balance: 100,
      }).success
    ).toBe(false);
  });
});
