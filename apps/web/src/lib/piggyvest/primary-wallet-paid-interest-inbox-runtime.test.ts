import { expect, it, vi } from 'vitest';
import { paidInterestFixture as fixture } from './primary-wallet-paid-interest.test-support';
import {
  readPrimaryWalletPaidInterestInboxRuntime,
  readPrimaryWalletPaidInterestInboxSecrets,
} from './primary-wallet-paid-interest-inbox-runtime';

vi.mock('server-only', () => ({}));
const env = {
  NODE_ENV: 'test' as const,
  VERCEL_ENV: 'production',
  PIGGYVEST_PRIMARY_PAID_INTEREST_INBOX_ENABLED: 'true',
  PIGGYVEST_PRIMARY_INTEGRATION_ID: fixture.config.integrationId,
  PIGGYVEST_PRIMARY_ENVIRONMENT: 'production',
  PIGGYVEST_PRIMARY_PAID_INTEREST_BUSINESS_ID: fixture.config.businessId,
  PIGGYVEST_PRIMARY_PAID_INTEREST_WEBHOOK_SECRET: fixture.config.webhookSecret,
  PIGGYVEST_PRIMARY_DB_HOST: fixture.config.database.host,
  PIGGYVEST_PRIMARY_DB_PORT: '5432',
  PIGGYVEST_PRIMARY_DB_NAME: 'postgres',
  PIGGYVEST_PRIMARY_EVIDENCE_DB_PASSWORD: fixture.config.database.password,
  PIGGYVEST_PRIMARY_DB_CA: fixture.config.database.certificateAuthority,
};
it('keeps inbox disabled unless explicitly enabled', () => {
  expect(
    readPrimaryWalletPaidInterestInboxRuntime({ NODE_ENV: 'test' })
  ).toBeNull();
});
it('exposes signing keys while the worker stays unconfigured', () => {
  const incomplete = {
    ...env,
    PIGGYVEST_PRIMARY_EVIDENCE_DB_PASSWORD: undefined,
  };
  expect(readPrimaryWalletPaidInterestInboxSecrets(incomplete)).toEqual({
    webhookSecret: fixture.config.webhookSecret,
    retainedWebhookSecrets: [],
  });
  expect(() => readPrimaryWalletPaidInterestInboxRuntime(incomplete)).toThrow(
    /configuration unavailable/
  );
  expect(
    readPrimaryWalletPaidInterestInboxSecrets({ NODE_ENV: 'test' })
  ).toBeNull();
});
it('keeps signing keys available while intake processing is rolled back', () => {
  const disabled = {
    ...env,
    PIGGYVEST_PRIMARY_PAID_INTEREST_INBOX_ENABLED: 'false',
  };
  expect(readPrimaryWalletPaidInterestInboxSecrets(disabled)).toEqual({
    webhookSecret: fixture.config.webhookSecret,
    retainedWebhookSecrets: [],
  });
  expect(readPrimaryWalletPaidInterestInboxRuntime(disabled)).toBeNull();
});
it('can preserve signed receipts while API credentials are unavailable', () => {
  const { providerToken: _token, ...config } = fixture.config;
  expect(readPrimaryWalletPaidInterestInboxRuntime(env)).toEqual({
    ...config,
    retainedWebhookSecrets: [],
  });
});
it('accepts bounded server-configured retained keys without exposing malformed values', () => {
  expect(
    readPrimaryWalletPaidInterestInboxRuntime({
      ...env,
      PIGGYVEST_PRIMARY_PAID_INTEREST_RETAINED_WEBHOOK_SECRETS:
        '["old-test-only-key"]',
    })?.retainedWebhookSecrets
  ).toEqual(['old-test-only-key']);
  for (const value of [
    'private-malformed-value',
    JSON.stringify(Array(5).fill('test-key')),
  ])
    expect(() =>
      readPrimaryWalletPaidInterestInboxRuntime({
        ...env,
        PIGGYVEST_PRIMARY_PAID_INTEREST_RETAINED_WEBHOOK_SECRETS: value,
      })
    ).toThrow('configuration unavailable');
});
it('rejects preview, staging and missing signing evidence', () => {
  expect(() =>
    readPrimaryWalletPaidInterestInboxRuntime({ ...env, VERCEL_ENV: 'preview' })
  ).toThrow('environment mismatch');
  expect(() =>
    readPrimaryWalletPaidInterestInboxRuntime({
      ...env,
      PIGGYVEST_PRIMARY_ENVIRONMENT: 'staging',
    })
  ).toThrow('configuration unavailable');
  expect(() =>
    readPrimaryWalletPaidInterestInboxRuntime({
      ...env,
      PIGGYVEST_PRIMARY_PAID_INTEREST_WEBHOOK_SECRET: undefined,
    })
  ).toThrow('configuration unavailable');
});
