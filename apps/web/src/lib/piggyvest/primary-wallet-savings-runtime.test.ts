import { beforeEach, expect, it, vi } from 'vitest';
import {
  readPrimaryWalletSavingsRecoveryRuntime,
  readPrimaryWalletSavingsRuntime,
} from './primary-wallet-savings-runtime';

const primary = vi.hoisted(() => vi.fn());
vi.mock('./primary-wallet-runtime', () => ({
  readPrimaryWalletRuntime: primary,
}));
beforeEach(() => {
  vi.clearAllMocks();
});
it('does not enable transfers when their independent flag is off', () => {
  expect(readPrimaryWalletSavingsRuntime({ NODE_ENV: 'test' })).toBeNull();
  expect(primary).not.toHaveBeenCalled();
});
it('does not use provisioning credentials when authorizer credentials are missing', () => {
  primary.mockReturnValue({
    onboarding: {
      integrationId: '11111111-1111-4111-8111-111111111111',
      environment: 'staging',
    },
    database: {
      host: 'db.example.com',
      port: 5432,
      name: 'postgres',
      login: 'baci_piggyvest_primary_provisioner',
      password: 'test-only',
      certificateAuthority: 'test-ca',
    },
  });
  expect(() =>
    readPrimaryWalletSavingsRuntime({
      NODE_ENV: 'test',
      PIGGYVEST_PRIMARY_SAVINGS_ENABLED: 'true',
    })
  ).toThrow();
});
it('builds recovery lookups without the savings enabled flag', () => {
  primary.mockReturnValue({
    onboarding: {
      integrationId: '11111111-1111-4111-8111-111111111111',
      environment: 'staging',
      merchantId: '33333333-3333-4333-8333-333333333333',
      businessId: 'business',
    },
    database: {
      host: 'db.example.com',
      port: 5432,
      name: 'postgres',
      login: 'baci_piggyvest_primary_provisioner',
      password: 'test-only',
      certificateAuthority: 'test-ca',
    },
  });
  const recovery = readPrimaryWalletSavingsRecoveryRuntime({
    NODE_ENV: 'test',
    PIGGYVEST_PRIMARY_AUTHORIZER_DB_PASSWORD: 'authorizer-secret',
  });
  expect(recovery.merchantId).toBe('33333333-3333-4333-8333-333333333333');
  expect(recovery).not.toHaveProperty('providerToken');
});
it('fails recovery lookups closed without primary configuration', () => {
  primary.mockReturnValue(null);
  expect(() =>
    readPrimaryWalletSavingsRecoveryRuntime({ NODE_ENV: 'test' })
  ).toThrow('Primary savings configuration unavailable');
});
