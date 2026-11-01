import { afterEach, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { readOxygenRuntimeConfiguration } from './runtime-configuration';

afterEach(() => vi.unstubAllEnvs());
const staging = {
  OXYGEN_STAGING_PARTNER_REFERENCE: 'staging-reference',
  OXYGEN_STAGING_PARTNER_SECRET: 'staging-secret',
  OXYGEN_STAGING_WORKER_EMAIL: 'stage@example.test',
  OXYGEN_STAGING_WORKER_PASSWORD: 'stage-password',
  OXYGEN_STAGING_HOSTED_HOSTS: 'staging.example.test',
  OXYGEN_DRAFT_ENCRYPTION_KEY: 'a'.repeat(64),
};
function set(values: Record<string, string>) {
  for (const [key, value] of Object.entries(values)) vi.stubEnv(key, value);
}
it('keeps production disabled even when production keys are present', () => {
  set({
    ...staging,
    VERCEL_ENV: 'production',
    OXYGEN_PRODUCTION_PARTNER_REFERENCE: 'live-reference',
    OXYGEN_PRODUCTION_PARTNER_SECRET: 'live-secret',
  });
  expect(readOxygenRuntimeConfiguration()).toBeNull();
});
it('never falls back to staging credentials on a production deployment', () => {
  set({
    ...staging,
    VERCEL_ENV: 'production',
    OXYGEN_PRODUCTION_RUNTIME_ENABLED: 'true',
  });
  expect(readOxygenRuntimeConfiguration()).toBeNull();
});
it('selects the fixed production origin only with a complete explicitly enabled production binding', () => {
  set({
    ...staging,
    VERCEL_ENV: 'production',
    OXYGEN_PRODUCTION_RUNTIME_ENABLED: 'true',
    OXYGEN_PRODUCTION_PARTNER_REFERENCE: 'live-reference',
    OXYGEN_PRODUCTION_PARTNER_SECRET: 'live-secret',
    OXYGEN_PRODUCTION_WORKER_EMAIL: 'live@example.test',
    OXYGEN_PRODUCTION_WORKER_PASSWORD: 'live-password',
    OXYGEN_PRODUCTION_HOSTED_HOSTS: 'checkout.example.test',
    OXYGEN_PRODUCTION_DRAFT_ENCRYPTION_KEY: 'b'.repeat(64),
  });
  expect(readOxygenRuntimeConfiguration()).toMatchObject({
    environment: 'production',
    baseUrl: 'https://api.oxygenx.africa/services/partners',
    reference: 'live-reference',
    secret: 'live-secret',
    email: 'live@example.test',
    evidenceKey: 'b'.repeat(64),
  });
  expect(
    readOxygenRuntimeConfiguration()?.hosts.has('payment.hydrogenpay.com')
  ).toBe(false);
});
it('preserves the existing isolated staging configuration', () => {
  set({ ...staging, VERCEL_ENV: 'preview' });
  expect(readOxygenRuntimeConfiguration()).toMatchObject({
    environment: 'staging',
    baseUrl: 'https://staging-api.theoxygen.com/services/partners',
    reference: 'staging-reference',
  });
  expect(
    readOxygenRuntimeConfiguration()?.hosts.has('payment.hydrogenpay.com')
  ).toBe(true);
});
it.each([
  'https://checkout.example.test',
  '*.paystack.com',
  'checkout.example.test:443',
  'evil.test/path',
])('rejects malformed hosted-host configuration %s', (host) => {
  set({ ...staging, VERCEL_ENV: 'preview', OXYGEN_STAGING_HOSTED_HOSTS: host });
  expect(readOxygenRuntimeConfiguration()).toBeNull();
});
