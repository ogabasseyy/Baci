import { describe, expect, it } from 'vitest';
import { piggyvestPrimaryWalletRuntimeSchema as schema } from './piggyvest-primary-wallet-runtime';

const input = {
  onboarding: {
    environment: 'production',
    merchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
    integrationId: 'd91d9e87-8e0d-44de-9b84-1e1d709633d2',
    businessId: 'test-business',
    businessBindingVerified: true,
    fingerprintKey: 'test-only-fingerprint-key-not-a-real-secret',
  },
  providerToken: 'test-only-token',
  database: {
    host: 'db.example.com',
    port: 5432,
    name: 'postgres',
    login: 'baci_piggyvest_primary_provisioner',
    password: 'test-only-password',
    certificateAuthority: 'test-only-ca',
  },
};
describe('primary wallet runtime configuration', () => {
  it('accepts restricted production configuration', () => {
    expect(schema.safeParse(input).success).toBe(true);
  });
  it.each([
    'postgres',
    'service_role',
    'piggyvest_staging_provisioner',
  ])('rejects an unintended database identity %s', (login) => {
    expect(
      schema.safeParse({ ...input, database: { ...input.database, login } })
        .success
    ).toBe(false);
  });
  it('requires certificate verification material', () => {
    expect(
      schema.safeParse({
        ...input,
        database: { ...input.database, certificateAuthority: '' },
      }).success
    ).toBe(false);
  });
  it('rejects local socket or provider host overrides', () => {
    expect(
      schema.safeParse({
        ...input,
        providerBaseUrl: 'https://untrusted.example',
      }).success
    ).toBe(false);
    expect(
      schema.safeParse({
        ...input,
        database: { ...input.database, host: '/tmp/db' },
      }).success
    ).toBe(false);
  });
});
