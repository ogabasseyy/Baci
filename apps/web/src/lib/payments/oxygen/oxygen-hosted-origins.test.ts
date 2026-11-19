import { afterEach, expect, it, vi } from 'vitest';
import { readOxygenHostedOrigins } from './oxygen-hosted-origins';

afterEach(() => vi.unstubAllEnvs());
it('never exposes staging hosts when production mode has no verified deployment identity', () => {
  vi.stubEnv('VERCEL_ENV', '');
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('OXYGEN_ENVIRONMENT', '');
  vi.stubEnv('OXYGEN_STAGING_HOSTED_HOSTS', 'stage.example.test');
  vi.stubEnv('OXYGEN_STAGING_SELFIE_HOSTS', 'stage.example.test');
  expect(readOxygenHostedOrigins()).toEqual({ hosted: [], selfie: [] });
  vi.stubEnv('OXYGEN_ENVIRONMENT', 'staging');
  expect(readOxygenHostedOrigins()).toEqual({ hosted: [], selfie: [] });
  vi.stubEnv('VERCEL_ENV', 'production');
  expect(readOxygenHostedOrigins()).toEqual({ hosted: [], selfie: [] });
});
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

it('reports a mismatched selfie allowlist without exposing configured hosts', async () => {
  vi.resetModules();
  const { readOxygenHostedOrigins: readFresh } = await import(
    './oxygen-hosted-origins'
  );
  vi.stubEnv('VERCEL_ENV', 'preview');
  vi.stubEnv('OXYGEN_STAGING_HOSTED_HOSTS', 'payment.example.test');
  vi.stubEnv('OXYGEN_STAGING_SELFIE_HOSTS', 'identity.example.test');
  const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    expect(readFresh()).toEqual({
      hosted: ['https://payment.example.test'],
      selfie: [],
    });
    readFresh();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      'oxygen_selfie_host_configuration_mismatch'
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain(
      'identity.example.test'
    );
  } finally {
    warn.mockRestore();
  }
});
