import { afterEach, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { oxygenPhoneConfiguration } from './phone-handoff-configuration';

afterEach(() => vi.unstubAllEnvs());
function config(
  origin = 'https://handoff.example.test',
  hosts = 'selfie.example.test'
) {
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
