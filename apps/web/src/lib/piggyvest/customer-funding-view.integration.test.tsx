import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { FundingPanel } from '@/components/storefront/piggyvest-savings/funding-panel';
import { readPiggyvestCustomerFundingView } from './customer-funding-view';

vi.mock('server-only', () => ({}));

function fixture() {
  const identity = {
    environment: 'staging',
    integrationId: '11111111-1111-4111-8111-111111111111',
    merchantId: '22222222-2222-4222-8222-222222222222',
    customerId: '33333333-3333-4333-8333-333333333333',
    goalId: '44444444-4444-4444-8444-444444444444',
    providerWalletId: 'synthetic-wallet',
    providerCustomerId: 'synthetic-customer',
  };
  const configuration = {
    environment: 'staging',
    integrationId: identity.integrationId,
    expectedMerchantId: identity.merchantId,
    expectedBusinessId: 'synthetic-business',
    expectedProjectId: 'synthetic-project',
    actualProjectId: 'synthetic-project',
    allowlistedCustomerIds: [identity.customerId],
    apiSecret: 'synthetic-secret',
    fingerprintKey: 'synthetic-fingerprint-key-0000000000',
    provisioningApproved: true,
    syntheticIdentityApproved: true,
    fundingDisplayEnabled: true,
  };
  const execute = vi.fn(async () => ({
    rows: [
      {
        merchant_id: identity.merchantId,
        customer_id: identity.customerId,
        goal_id: identity.goalId,
      },
    ],
  }));
  const fetchImplementation = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      Response.json({
        status: true,
        data: {
          id: identity.providerWalletId,
          business_id: configuration.expectedBusinessId,
          currency: 'NGN',
          status: 'active',
          balance: 0,
        },
      })
    )
    .mockResolvedValueOnce(
      Response.json({
        status: true,
        data: [
          {
            account_number: '0001234567',
            account_name: 'Synthetic account',
            bank_name: 'Synthetic Bank',
            paypoint_id: 'private-paypoint',
            paypoint_name: 'Private provider field',
          },
        ],
      })
    );
  return { identity, configuration, execute, fetchImplementation };
}

it('connects the scoped server projection to funding display without exposing provider fields', async () => {
  const dependencies = fixture();
  const load = async () =>
    readPiggyvestCustomerFundingView({
      ...dependencies,
      resolveAuthenticatedGoal: async () => dependencies.identity,
    });
  render(<FundingPanel requestKey="synthetic-session:goal" load={load} />);
  expect(await screen.findByText('0001234567')).toBeVisible();
  expect(screen.getByText('Synthetic Bank')).toBeVisible();
  expect(
    screen.getByText(
      'Test environment only. Do not send real money to these details.'
    )
  ).toBeVisible();
  expect(screen.queryByText('Private provider field')).not.toBeInTheDocument();
  expect(screen.queryByText('synthetic-secret')).not.toBeInTheDocument();
  expect(dependencies.fetchImplementation).toHaveBeenCalledTimes(2);
});

it('shows no funding details when the authenticated customer is outside the staging allowlist', async () => {
  const dependencies = fixture();
  const load = async () =>
    readPiggyvestCustomerFundingView({
      ...dependencies,
      resolveAuthenticatedGoal: async () => ({
        ...dependencies.identity,
        customerId: '55555555-5555-4555-8555-555555555555',
      }),
    });
  render(<FundingPanel requestKey="other-session:goal" load={load} />);
  expect(
    await screen.findByText('Test funding details are unavailable.')
  ).toBeVisible();
  expect(dependencies.execute).not.toHaveBeenCalled();
  expect(dependencies.fetchImplementation).not.toHaveBeenCalled();
});
