import { expect, it, vi } from 'vitest';
import { paidInterestFixture as fixture } from './primary-wallet-paid-interest.test-support';
import { readPrimaryWalletPaidInterestRuntime } from './primary-wallet-paid-interest-runtime';

vi.mock('server-only', () => ({}));
const env = {
  NODE_ENV: 'test' as const,
  PIGGYVEST_PRIMARY_PAID_INTEREST_ENABLED: 'true',
  VERCEL_ENV: 'production',
  PIGGYVEST_PRIMARY_INTEGRATION_ID: fixture.config.integrationId,
  PIGGYVEST_PRIMARY_ENVIRONMENT: 'production',
  PIGGYVEST_PRIMARY_PAID_INTEREST_BUSINESS_ID: fixture.config.businessId,
  PIGGYVEST_PRIMARY_PAID_INTEREST_API_TOKEN: fixture.config.providerToken,
  PIGGYVEST_PRIMARY_PAID_INTEREST_WEBHOOK_SECRET: fixture.config.webhookSecret,
  PIGGYVEST_PRIMARY_DB_HOST: fixture.config.database.host,
  PIGGYVEST_PRIMARY_DB_PORT: '5432',
  PIGGYVEST_PRIMARY_DB_NAME: 'postgres',
  PIGGYVEST_PRIMARY_EVIDENCE_DB_PASSWORD: fixture.config.database.password,
  PIGGYVEST_PRIMARY_DB_CA: fixture.config.database.certificateAuthority,
};
it('is disabled unless explicitly enabled', () => {
  expect(readPrimaryWalletPaidInterestRuntime({ NODE_ENV: 'test' })).toBeNull();
});
it('reads a strictly production-bound dedicated evidence configuration', () => {
  expect(readPrimaryWalletPaidInterestRuntime(env)).toEqual(fixture.config);
});
it('rejects preview and staging environments instead of falling back', () => {
  expect(() =>
    readPrimaryWalletPaidInterestRuntime({ ...env, VERCEL_ENV: 'preview' })
  ).toThrow('environment mismatch');
  expect(() =>
    readPrimaryWalletPaidInterestRuntime({
      ...env,
      PIGGYVEST_PRIMARY_ENVIRONMENT: 'staging',
    })
  ).toThrow('configuration unavailable');
});
it('fails closed when dedicated signing or API credentials are unavailable', () => {
  expect(() =>
    readPrimaryWalletPaidInterestRuntime({
      ...env,
      PIGGYVEST_PRIMARY_PAID_INTEREST_WEBHOOK_SECRET: undefined,
    })
  ).toThrow('configuration unavailable');
  expect(() =>
    readPrimaryWalletPaidInterestRuntime({
      ...env,
      PIGGYVEST_PRIMARY_PAID_INTEREST_API_TOKEN: undefined,
    })
  ).toThrow('configuration unavailable');
});
