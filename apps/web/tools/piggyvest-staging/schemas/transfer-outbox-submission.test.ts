import { describe, expect, it } from 'vitest';
import { transferOutboxSubmissionSchemas } from './transfer-outbox-submission';

const command = {
  authorizationId: 'a0065070-dc32-45d2-9c01-871a27abfd10',
  reference: 'submission-001',
  customerId: 'c0065070-dc32-45d2-9c01-871a27abfd10',
  merchantId: '43e157b6-179c-432a-9392-e0827da96d82',
  walletId: 'ledger-wallet-001',
  amountKobo: 500_000,
  currency: 'NGN',
  sourceWalletId: 'source-wallet-001',
  destinationRef: '058:6789',
  direction: 'bank',
  providerCustomerId: 'provider-customer-001',
  businessId: 'business-001',
  integrationId: 'integration-001',
};

describe('transfer outbox submission schemas', () => {
  it('refuses a submission without the provider scope that finality requires', () => {
    expect(
      transferOutboxSubmissionSchemas.command.safeParse({
        ...command,
        integrationId: undefined,
      }).success
    ).toBe(false);
  });

  it('refuses a submission without an independently provisioned authorization', () => {
    expect(
      transferOutboxSubmissionSchemas.command.safeParse({
        ...command,
        authorizationId: undefined,
      }).success
    ).toBe(false);
  });

  it('refuses unmasked bank destination data before a claim can persist it', () => {
    expect(
      transferOutboxSubmissionSchemas.command.safeParse({
        ...command,
        destinationRef: '058:0123456789',
      }).success
    ).toBe(false);
  });
});
