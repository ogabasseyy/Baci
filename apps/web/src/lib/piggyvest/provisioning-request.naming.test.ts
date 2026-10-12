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
  fingerprintKey: 'synthetic-fingerprint-key-at-least-32-bytes',
  apiSecret: 'synthetic-provider-secret',
  expectedBusinessId: 'synthetic-business',
};
const command = {
  merchantId: configuration.expectedMerchantId,
  customerId: configuration.allowlistedCustomerIds[0],
  kind: 'create_plan_wallet',
  goalId: '33333333-3333-4333-8333-333333333333',
  providerCustomerId: 'synthetic-customer',
  reserveVirtualAccount: true,
  enableInterestAccrual: false,
  interestPayout: 'own_wallet',
  customerName: 'Bassey Effiong',
};

describe('plan wallet customer naming', () => {
  it('sends a readable customer name rather than the opaque baci hash', () => {
    const request = buildPiggyvestProvisioningRequest({
      configuration,
      command,
    });

    expect(JSON.parse(request.body)).toEqual({
      subaccount_name: 'Bassey Effiong Savings D4851B9412725E22',
      customer_id: 'synthetic-customer',
      reserve_virtual_account: true,
      enable_interest_accrual: false,
    });
    expect(request.body).not.toContain('customerName');
  });

  it('normalizes equivalent names to the same request and retry fingerprint', () => {
    const first = buildPiggyvestProvisioningRequest({ configuration, command });
    const normalized = buildPiggyvestProvisioningRequest({
      configuration,
      command: { ...command, customerName: ' Ｂａｓｓｅｙ\u00a0  Effiong ' },
    });

    expect(normalized.body).toBe(first.body);
    expect(normalized.requestFingerprint).toBe(first.requestFingerprint);
  });

  it('keeps legacy request bytes and fingerprint when the customer name is absent', () => {
    const { customerName, ...legacyCommand } = command;
    const legacy = buildPiggyvestProvisioningRequest({
      configuration,
      command: legacyCommand,
    });

    expect(customerName).toBe('Bassey Effiong');
    expect(JSON.parse(legacy.body).subaccount_name).toBe(
      'bacid4851b9412725e22e51c6197d9aa09fb57d36a59'
    );
    expect(legacy.requestFingerprint).toBe(
      '90bac45ab94ffcb1a3b6302a5e0e019c83152cc8cd9e600c1268c66c987c0f11'
    );
  });

  it('retains a deterministic suffix across customer names but separates goals and integrations', () => {
    const name = (changes: object, config = configuration) =>
      JSON.parse(
        buildPiggyvestProvisioningRequest({
          configuration: config,
          command: { ...command, ...changes },
        }).body
      ).subaccount_name as string;

    expect(name({ customerName: 'Another Customer' }).split(' ').at(-1)).toBe(
      name({}).split(' ').at(-1)
    );
    expect(name({ goalId: '77777777-7777-4777-8777-777777777777' })).not.toBe(
      name({})
    );
    expect(
      name(
        {},
        {
          ...configuration,
          integrationId: '88888888-8888-4888-8888-888888888888',
        }
      )
    ).not.toBe(name({}));
  });

  it.each([
    'A'.repeat(512),
    'Chiamaka '.repeat(40),
    '李'.repeat(100),
  ])('bounds long names without truncating the stable suffix', (customerName) => {
    const request = buildPiggyvestProvisioningRequest({
      configuration,
      command: { ...command, customerName },
    });
    const name = JSON.parse(request.body).subaccount_name as string;

    expect(Array.from(name).length).toBeLessThanOrEqual(50);
    expect(name).toMatch(/ Savings D4851B9412725E22$/);
  });

  it('preserves accented names and excludes formatting controls from the display name', () => {
    const request = buildPiggyvestProvisioningRequest({
      configuration,
      command: { ...command, customerName: 'Adéọla\u202e Okafor' },
    });

    expect(JSON.parse(request.body).subaccount_name).toBe(
      'Adéọla Okafor Savings D4851B9412725E22'
    );
  });
});
