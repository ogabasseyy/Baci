import { beforeEach, expect, it, vi } from 'vitest';
import { readPrimaryWalletSavingsRuntime } from './primary-wallet-savings-runtime';

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
