import { expect, it } from 'vitest';
import { provisioningFixture } from '@/lib/piggyvest/primary-savings-provisioning.test-support';
import { primarySavingsProvisioningSchemas as schemas } from './primary-savings-provisioning';

it('accepts explicit wallet provisioning consent for an exact goal', () => {
  expect(
    schemas.request.parse({
      merchantId: provisioningFixture.scope.merchantId,
      goalId: provisioningFixture.goalId,
      consent: true,
      interestAccepted: false,
    }).consent
  ).toBe(true);
});
it.each([
  { consent: false },
  { consent: undefined },
  { customerId: 'foreign' },
  { providerWalletId: 'foreign' },
  { enableInterestAccrual: true },
  { metadata: { interestOptIn: true } },
  { goalId: '' },
])('rejects missing consent or caller-controlled provider identity/options %j', (change) => {
  expect(
    schemas.request.safeParse({
      merchantId: provisioningFixture.scope.merchantId,
      goalId: provisioningFixture.goalId,
      consent: true,
      interestAccepted: false,
      ...change,
    }).success
  ).toBe(false);
});
it('permits only a restricted provisioner login', () => {
  expect(
    schemas.runtime.safeParse(provisioningFixture.configuration).success
  ).toBe(true);
  expect(
    schemas.runtime.safeParse({
      ...provisioningFixture.configuration,
      database: {
        ...provisioningFixture.configuration.database,
        login: 'postgres',
      },
    }).success
  ).toBe(false);
});
it('preserves explicit interest consent rather than accepting caller-selected provider options', () => {
  const proof = {
    providerCustomerId: 'customer',
    providerWalletId: 'wallet',
    walletName: 'name',
    businessId: 'business',
    currency: 'NGN',
    status: 'active',
    type: 'api',
    hasFundingAccount: true,
    interestAccepted: false,
  };
  expect(schemas.proof.safeParse(proof).success).toBe(true);
  expect(
    schemas.proof.safeParse({ ...proof, interestAccepted: true }).success
  ).toBe(true);
  expect(
    schemas.proof.safeParse({ ...proof, interestAccepted: 'true' }).success
  ).toBe(false);
});
it('requires an explicit interest choice and preserves both accepted and declined consent', () => {
  const request = {
    merchantId: provisioningFixture.scope.merchantId,
    goalId: provisioningFixture.goalId,
    consent: true,
  };
  expect(schemas.request.safeParse(request).success).toBe(false);
  expect(
    schemas.request.parse({ ...request, interestAccepted: false })
      .interestAccepted
  ).toBe(false);
  expect(
    schemas.request.parse({ ...request, interestAccepted: true })
      .interestAccepted
  ).toBe(true);
  expect(
    schemas.request.safeParse({ ...request, interestAccepted: 'true' }).success
  ).toBe(false);
});
it('requires verified accounts only in ready responses and keeps payout claims out of the schema', () => {
  const response = {
    goalId: provisioningFixture.goalId,
    status: 'pending',
    interestAccepted: false,
    interestEnrollment: 'not_requested',
    accounts: [],
  };
  expect(schemas.response.safeParse(response).success).toBe(true);
  expect(
    schemas.response.safeParse({ ...response, status: 'ready' }).success
  ).toBe(false);
  expect(
    schemas.response.safeParse({ ...response, interestEnabled: true }).success
  ).toBe(false);
});
