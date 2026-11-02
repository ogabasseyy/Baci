import { afterEach, expect, it, vi } from 'vitest';
import { readOxygenHostedOrigins } from './oxygen-hosted-origins';

afterEach(() => vi.unstubAllEnvs());
it('uses exact configured staging hosts with selfie limited to the configured intersection', () => {
  vi.stubEnv('VERCEL_ENV', 'preview');
  vi.stubEnv(
    'OXYGEN_STAGING_HOSTED_HOSTS',
    'frame.example.test,payment.example.test'
  );
  vi.stubEnv(
    'OXYGEN_STAGING_SELFIE_HOSTS',
    'frame.example.test,not-hosted.example.test'
  );
  expect(readOxygenHostedOrigins()).toEqual({
    hosted: ['https://frame.example.test', 'https://payment.example.test'],
    selfie: ['https://frame.example.test'],
  });
});
it('does not expose production origins until explicitly enabled', () => {
  vi.stubEnv('VERCEL_ENV', 'production');
  vi.stubEnv('OXYGEN_PRODUCTION_RUNTIME_ENABLED', '');
  vi.stubEnv('OXYGEN_PRODUCTION_HOSTED_HOSTS', 'live.example.test');
  vi.stubEnv('OXYGEN_PRODUCTION_SELFIE_HOSTS', 'live.example.test');
  expect(readOxygenHostedOrigins()).toEqual({ hosted: [], selfie: [] });
});
it.each([
  '*.evil.test',
  'example.test:443',
  'https://example.test',
  'good.test; evil.test',
  'good.test/path',
])('rejects malformed configured hosts %s', (value) => {
  vi.stubEnv('VERCEL_ENV', 'preview');
  vi.stubEnv('OXYGEN_STAGING_HOSTED_HOSTS', value);
  vi.stubEnv('OXYGEN_STAGING_SELFIE_HOSTS', 'frame.example.test');
  expect(readOxygenHostedOrigins()).toEqual({ hosted: [], selfie: [] });
});
it('uses only production configuration after production is explicitly enabled', () => {
  vi.stubEnv('VERCEL_ENV', 'production');
  vi.stubEnv('OXYGEN_PRODUCTION_RUNTIME_ENABLED', 'true');
  vi.stubEnv(
    'OXYGEN_PRODUCTION_HOSTED_HOSTS',
    'identity.live.example.test,payment.live.example.test'
  );
  vi.stubEnv('OXYGEN_PRODUCTION_SELFIE_HOSTS', 'identity.live.example.test');
  vi.stubEnv('OXYGEN_STAGING_HOSTED_HOSTS', 'staging.example.test');
  expect(readOxygenHostedOrigins()).toEqual({
    hosted: [
      'https://identity.live.example.test',
      'https://payment.live.example.test',
    ],
    selfie: ['https://identity.live.example.test'],
  });
});
it('fails closed when selfie host configuration contains an invalid value', () => {
  vi.stubEnv('VERCEL_ENV', 'preview');
  vi.stubEnv('OXYGEN_STAGING_HOSTED_HOSTS', 'frame.example.test');
  vi.stubEnv('OXYGEN_STAGING_SELFIE_HOSTS', 'frame.example.test,*.evil.test');
  expect(readOxygenHostedOrigins()).toEqual({ hosted: [], selfie: [] });
});
