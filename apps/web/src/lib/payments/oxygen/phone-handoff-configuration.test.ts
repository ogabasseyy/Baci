import { afterEach, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { oxygenPhoneConfiguration } from './phone-handoff-configuration';

afterEach(() => vi.unstubAllEnvs());
function config(
  origin = 'https://handoff.example.test',
  hosts = 'selfie.example.test'
) {
  vi.stubEnv('VERCEL_ENV', 'production');
  vi.stubEnv('OXYGEN_PRODUCTION_RUNTIME_ENABLED', 'true');
  vi.stubEnv('OXYGEN_PRODUCTION_HOSTED_HOSTS', hosts);
  vi.stubEnv('OXYGEN_PRODUCTION_DURABLE_HANDOFF_ENABLED', 'true');
  vi.stubEnv('OXYGEN_PRODUCTION_HANDOFF_ORIGIN', origin);
  vi.stubEnv('OXYGEN_PRODUCTION_SELFIE_HOSTS', hosts);
  return oxygenPhoneConfiguration('production', 'a'.repeat(64));
}
it('requires an explicitly enabled HTTPS origin and exact selfie hosts', () => {
  expect(oxygenPhoneConfiguration('production', 'a'.repeat(64))).toBeNull();
  expect(config()?.hosts.has('selfie.example.test')).toBe(true);
  expect(config()?.hosts.has('payment.hydrogenpay.com')).toBe(false);
});
it.each([
  'http://handoff.example.test',
  'https://handoff.example.test/path',
  'https://handoff.example.test?x=1',
  'https://user@handoff.example.test',
  'https://handoff.example.test:444',
])('rejects unsafe destination %s', (origin) =>
  expect(config(origin)).toBeNull());
it.each([
  '*.example.test',
  'https://selfie.example.test',
  'selfie.example.test/path',
])('rejects unsafe selfie host %s', (hosts) =>
  expect(config(undefined, hosts)).toBeNull());

it('disables handoff when no selfie host is permitted by the hosted surface', () => {
  config();
  vi.stubEnv('OXYGEN_PRODUCTION_HOSTED_HOSTS', 'other.example.test');
  expect(oxygenPhoneConfiguration('production', 'a'.repeat(64))).toBeNull();
});
it('limits issued targets to selfie hosts allowed by the browser surface', () => {
  config(undefined, 'selfie.example.test,excluded.example.test');
  vi.stubEnv('OXYGEN_PRODUCTION_HOSTED_HOSTS', 'selfie.example.test');
  expect(oxygenPhoneConfiguration('production', 'a'.repeat(64))?.hosts).toEqual(
    new Set(['selfie.example.test'])
  );
});
it('disables handoff if the runtime or resolved environment is disabled', () => {
  config();
  vi.stubEnv('OXYGEN_PRODUCTION_RUNTIME_ENABLED', 'false');
  expect(oxygenPhoneConfiguration('production', 'a'.repeat(64))).toBeNull();
  vi.stubEnv('OXYGEN_PRODUCTION_RUNTIME_ENABLED', 'true');
  vi.stubEnv('VERCEL_ENV', 'preview');
  expect(oxygenPhoneConfiguration('production', 'a'.repeat(64))).toBeNull();
});
it('uses the same hosted and selfie intersection in staging', () => {
  vi.stubEnv('VERCEL_ENV', 'preview');
  vi.stubEnv('OXYGEN_ENVIRONMENT', 'staging');
  vi.stubEnv('OXYGEN_STAGING_DURABLE_HANDOFF_ENABLED', 'true');
  vi.stubEnv('OXYGEN_STAGING_HANDOFF_ORIGIN', 'https://handoff.example.test');
  vi.stubEnv('OXYGEN_STAGING_HOSTED_HOSTS', 'shared.example.test');
  vi.stubEnv(
    'OXYGEN_STAGING_SELFIE_HOSTS',
    'shared.example.test,other.example.test'
  );
  expect(oxygenPhoneConfiguration('staging', 'a'.repeat(64))?.hosts).toEqual(
    new Set(['shared.example.test'])
  );
});
