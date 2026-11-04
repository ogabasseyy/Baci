import { afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ create: vi.fn(), signIn: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.create }));
vi.mock('@/env', () => ({
  getSupabaseUrl: () => 'https://db.example.test',
  getSupabaseAnonKey: () => 'synthetic-public-key',
}));

import {
  connectOxygenRuntime,
  oxygenRuntimeCallbackConfiguration,
} from './runtime-connection';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});
it('does not configure execution when a required runtime secret is missing', () => {
  vi.stubEnv('OXYGEN_STAGING_PARTNER_REFERENCE', '');
  expect(connectOxygenRuntime()).toBeNull();
  expect(mocks.create).not.toHaveBeenCalled();
});
it('uses ordinary Auth worker credentials and a separate partner login on the fixed staging origin', async () => {
  vi.stubEnv('VERCEL_ENV', 'preview');
  for (const [name, value] of Object.entries({
    OXYGEN_STAGING_PARTNER_REFERENCE: 'partner',
    OXYGEN_STAGING_PARTNER_SECRET: 'synthetic-secret',
    OXYGEN_STAGING_WORKER_EMAIL: 'worker@example.test',
    OXYGEN_STAGING_WORKER_PASSWORD: 'synthetic-password',
    OXYGEN_STAGING_HOSTED_HOSTS: 'hosted.example.test,payment.hydrogenpay.com',
    OXYGEN_DRAFT_ENCRYPTION_KEY: 'a'.repeat(64),
  }))
    vi.stubEnv(name, value);
  mocks.signIn.mockResolvedValue({
    error: null,
    data: { session: { expires_at: Math.floor(Date.now() / 1000) + 300 } },
  });
  const client = { auth: { signInWithPassword: mocks.signIn } };
  mocks.create.mockReturnValue(client);
  const requests: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      requests.push(String(url));
      return Response.json(
        String(url).endsWith('/partner/login')
          ? { token: 'synthetic-token', expires_in: 300 }
          : { test: 'ok' }
      );
    })
  );
  const runtime = connectOxygenRuntime();
  expect(runtime).not.toBeNull();
  if (!runtime) throw new Error('Expected staging runtime');
  expect(runtime.hosts.has('payment.hydrogenpay.com')).toBe(true);
  expect(runtime.hosts.has('payment.hydrogenpay.com.evil.test')).toBe(false);
  await expect(runtime.worker()).resolves.toBe(client);
  expect(mocks.create).toHaveBeenCalledWith(
    'https://db.example.test',
    'synthetic-public-key',
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    }
  );
  await expect(runtime.provider.call('kyc', {})).resolves.toEqual({
    test: 'ok',
  });
  expect(requests).toEqual([
    'https://staging-api.theoxygen.com/services/partners/v1/partner/login',
    'https://staging-api.theoxygen.com/services/partners/v1/loan-request/validate/kyc/status',
  ]);
});

it('refuses to enable the staging adapter in a production deployment', () => {
  vi.stubEnv('VERCEL_ENV', 'production');
  expect(connectOxygenRuntime()).toBeNull();
  expect(mocks.create).not.toHaveBeenCalled();
});
it('does not use staging callback credentials for an ambiguous or mismatched deployment', () => {
  vi.stubEnv('VERCEL_ENV', '');
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('OXYGEN_ENVIRONMENT', '');
  vi.stubEnv('OXYGEN_STAGING_PARTNER_REFERENCE', 'partner');
  vi.stubEnv('OXYGEN_STAGING_CALLBACK_KEY', 'key');
  vi.stubEnv('OXYGEN_STAGING_CALLBACK_SECRET', 'secret');
  expect(oxygenRuntimeCallbackConfiguration()).toBeNull();
  vi.stubEnv('OXYGEN_ENVIRONMENT', 'staging');
  expect(oxygenRuntimeCallbackConfiguration()).toBeNull();
  vi.stubEnv('VERCEL_ENV', 'production');
  expect(oxygenRuntimeCallbackConfiguration()).toBeNull();
});

it('selects callback credentials only from the configured deployment environment', () => {
  for (const [name, value] of Object.entries({
    OXYGEN_STAGING_PARTNER_REFERENCE: 'stage-partner',
    OXYGEN_STAGING_CALLBACK_KEY: 'stage-key',
    OXYGEN_STAGING_CALLBACK_SECRET: 'stage-secret',
    OXYGEN_PRODUCTION_PARTNER_REFERENCE: 'prod-partner',
    OXYGEN_PRODUCTION_CALLBACK_KEY: 'prod-key',
    OXYGEN_PRODUCTION_CALLBACK_SECRET: 'prod-secret',
    OXYGEN_PRODUCTION_RUNTIME_ENABLED: 'true',
  }))
    vi.stubEnv(name, value);
  vi.stubEnv('OXYGEN_ENVIRONMENT', 'staging');
  vi.stubEnv('VERCEL_ENV', 'preview');
  expect(oxygenRuntimeCallbackConfiguration()).toEqual({
    partnerReference: 'stage-partner',
    auth: { mode: 'API_KEY', apiKey: 'stage-key', apiSecret: 'stage-secret' },
  });
  vi.stubEnv('OXYGEN_ENVIRONMENT', 'production');
  vi.stubEnv('VERCEL_ENV', 'production');
  expect(oxygenRuntimeCallbackConfiguration()).toEqual({
    partnerReference: 'prod-partner',
    auth: { mode: 'API_KEY', apiKey: 'prod-key', apiSecret: 'prod-secret' },
  });
  vi.stubEnv('OXYGEN_PRODUCTION_CALLBACK_SECRET', '');
  expect(oxygenRuntimeCallbackConfiguration()).toBeNull();
});

it('refuses execution when response evidence cannot be encrypted', () => {
  vi.stubEnv('VERCEL_ENV', 'preview');
  for (const name of [
    'OXYGEN_STAGING_PARTNER_REFERENCE',
    'OXYGEN_STAGING_PARTNER_SECRET',
    'OXYGEN_STAGING_WORKER_EMAIL',
    'OXYGEN_STAGING_WORKER_PASSWORD',
    'OXYGEN_STAGING_HOSTED_HOSTS',
  ])
    vi.stubEnv(name, 'synthetic-configured');
  vi.stubEnv('OXYGEN_DRAFT_ENCRYPTION_KEY', '');
  expect(connectOxygenRuntime()).toBeNull();
  expect(mocks.create).not.toHaveBeenCalled();
});

it('rejects a trial request without a configured exact staging binding before provider login', async () => {
  vi.stubEnv('VERCEL_ENV', 'preview');
  for (const [name, value] of Object.entries({
    OXYGEN_STAGING_PARTNER_REFERENCE: 'partner',
    OXYGEN_STAGING_PARTNER_SECRET: 'synthetic-secret',
    OXYGEN_STAGING_WORKER_EMAIL: 'worker@example.test',
    OXYGEN_STAGING_WORKER_PASSWORD: 'synthetic-password',
    OXYGEN_STAGING_HOSTED_HOSTS: 'hosted.example.test',
    OXYGEN_DRAFT_ENCRYPTION_KEY: 'a'.repeat(64),
    OXYGEN_STAGING_ACTIVATION_TRIAL_BINDINGS: '',
  }))
    vi.stubEnv(name, value);
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  const runtime = connectOxygenRuntime();
  expect(runtime).not.toBeNull();
  await expect(
    runtime?.activationTrialRequest(
      'activate',
      '70000000-0000-4000-8000-000000000001'
    )
  ).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
  expect(mocks.create).not.toHaveBeenCalled();
});
