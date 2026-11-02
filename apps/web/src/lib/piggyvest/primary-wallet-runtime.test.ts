import { describe, expect, it, vi } from 'vitest';
import {
  readPrimaryWalletOnboardingRuntime,
  readPrimaryWalletRuntime,
  readPrimaryWalletRuntimeDrain,
} from './primary-wallet-runtime';

vi.mock('server-only', () => ({}));
const env: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  VERCEL_ENV: 'production',
  PIGGYVEST_PRIMARY_ENABLED: 'true',
  PIGGYVEST_PRIMARY_ENVIRONMENT: 'production',
  PIGGYVEST_PRIMARY_MERCHANT_ID: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
  PIGGYVEST_PRIMARY_INTEGRATION_ID: 'd91d9e87-8e0d-44de-9b84-1e1d709633d2',
  PIGGYVEST_PRIMARY_BUSINESS_ID: 'test-business',
  PIGGYVEST_PRIMARY_BUSINESS_BINDING_VERIFIED: 'true',
  PIGGYVEST_PRIMARY_FINGERPRINT_KEY:
    'test-only-fingerprint-key-not-a-real-secret',
  PIGGYVEST_PRIMARY_PROVIDER_TOKEN: 'test-only-token',
  PIGGYVEST_PRIMARY_DB_HOST: 'db.example.com',
  PIGGYVEST_PRIMARY_DB_PORT: '5432',
  PIGGYVEST_PRIMARY_DB_NAME: 'postgres',
  PIGGYVEST_PRIMARY_DB_PASSWORD: 'test-only-password',
  PIGGYVEST_PRIMARY_DB_CA: 'test-only-ca',
  PIGGYVEST_PRIMARY_INTEREST_PAYOUT_WALLET_ID: '01JBZ8Q5W3X9R2K4M6N8P0T2V4',
};
describe('primary wallet runtime environment', () => {
  it('loads an explicitly enabled complete production runtime', () => {
    expect(readPrimaryWalletRuntime(env)?.onboarding.environment).toBe(
      'production'
    );
  });
  it('does not activate from staging or incomplete configuration', () => {
    expect(
      readPrimaryWalletRuntime({
        ...env,
        PIGGYVEST_PRIMARY_ENVIRONMENT: 'staging',
      })
    ).toBeNull();
    expect(
      readPrimaryWalletRuntime({ ...env, PIGGYVEST_PRIMARY_ENABLED: 'false' })
    ).toBeNull();
    expect(
      readPrimaryWalletRuntime({ ...env, PIGGYVEST_PRIMARY_DB_CA: '' })
    ).toBeNull();
  });
  it('lets the drain reader bypass only the enabled flag', () => {
    // Flag off but credentials-bound: recovery lookups still resolve.
    expect(
      readPrimaryWalletRuntimeDrain({
        ...env,
        PIGGYVEST_PRIMARY_ENABLED: 'false',
      })?.onboarding.merchantId
    ).toBe('6b5cb8a4-5575-456c-b936-8cdfae30db74');
    // Environment binding and credentials still fail closed.
    expect(
      readPrimaryWalletRuntimeDrain({
        ...env,
        PIGGYVEST_PRIMARY_ENABLED: 'false',
        PIGGYVEST_PRIMARY_ENVIRONMENT: 'staging',
      })
    ).toBeNull();
    expect(
      readPrimaryWalletRuntimeDrain({
        ...env,
        PIGGYVEST_PRIMARY_ENABLED: 'false',
        PIGGYVEST_PRIMARY_DB_PASSWORD: '',
      })
    ).toBeNull();
  });
  it('adds the interest payout wallet only to the onboarding reader', () => {
    expect(readPrimaryWalletOnboardingRuntime(env)).toEqual({
      runtime: readPrimaryWalletRuntime(env),
      interestPayoutWalletId: '01JBZ8Q5W3X9R2K4M6N8P0T2V4',
    });
    // The shared runtime stays strict: no onboarding-only field leaks in.
    expect(readPrimaryWalletRuntime(env)?.onboarding).not.toHaveProperty(
      'interestPayoutWalletId'
    );
  });
  it.each([
    undefined,
    '',
    ' 01JBZ8Q5W3X9R2K4M6N8P0T2V4',
    '01JBZ8Q5W3X9R2K4M6N8P0T2V4\n',
    '01jbz8q5w3x9r2k4m6n8p0t2v4',
    '01JBZ8Q5W3X9R2K4M6N8P0T2VI',
    '01JBZ8Q5W3X9R2K4M6N8P0T2V',
  ])('makes onboarding not ready for payout wallet %j', (value) => {
    const configured = {
      ...env,
      PIGGYVEST_PRIMARY_INTEREST_PAYOUT_WALLET_ID: value,
    };
    expect(readPrimaryWalletOnboardingRuntime(configured)).toBeNull();
    // Reads, savings and drain never depend on the onboarding-only setting.
    expect(readPrimaryWalletRuntime(configured)).not.toBeNull();
    expect(readPrimaryWalletRuntimeDrain(configured)).not.toBeNull();
  });
  it('keeps onboarding off when the base runtime is off', () => {
    expect(
      readPrimaryWalletOnboardingRuntime({
        ...env,
        PIGGYVEST_PRIMARY_ENABLED: 'false',
      })
    ).toBeNull();
  });
});
