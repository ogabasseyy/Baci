import { describe, expect, it, vi } from 'vitest';
import { readPrimaryWalletRuntime } from './primary-wallet-runtime';

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
});
