import { afterEach, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ after: vi.fn(), createClient: vi.fn() }));
vi.mock('server-only', () => ({}));
type NextServerModule = typeof import('next/server');
vi.mock('next/server', async (original) => ({
  ...(await original<NextServerModule>()),
  after: m.after,
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: m.createClient }));
vi.mock('@/env', () => ({
  getSupabaseUrl: () => 'https://db.example.test',
  getSupabaseAnonKey: () => 'synthetic-key',
}));

import { POST } from './route';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

it('refuses production callbacks before worker or provider work when flags are unset', async () => {
  vi.stubEnv('VERCEL_ENV', 'production');
  vi.stubEnv('OXYGEN_ENVIRONMENT', undefined);
  vi.stubEnv('OXYGEN_PRODUCTION_RUNTIME_ENABLED', undefined);
  vi.stubEnv('OXYGEN_PRODUCTION_AUTOMATIC_ACTIVATION_ENABLED', undefined);
  vi.stubEnv('OXYGEN_CALLBACK_DRAIN_ENABLED', undefined);
  for (const [key, value] of Object.entries({
    OXYGEN_PRODUCTION_PARTNER_REFERENCE: 'synthetic-partner',
    OXYGEN_PRODUCTION_PARTNER_SECRET: 'synthetic-secret',
    OXYGEN_PRODUCTION_WORKER_EMAIL: 'worker@example.test',
    OXYGEN_PRODUCTION_WORKER_PASSWORD: 'synthetic-password',
    OXYGEN_PRODUCTION_HOSTED_HOSTS: 'hosted.example.test',
    OXYGEN_PRODUCTION_DRAFT_ENCRYPTION_KEY: 'a'.repeat(64),
    OXYGEN_PRODUCTION_CALLBACK_KEY: 'synthetic-key',
    OXYGEN_PRODUCTION_CALLBACK_SECRET: 'synthetic-secret',
  }))
    vi.stubEnv(key, value);
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  const response = await POST(
    new Request('https://example.test/api/payments/oxygen/webhook', {
      method: 'POST',
      headers: {
        api_key: 'synthetic-key',
        api_secret: 'synthetic-secret',
        'content-type': 'application/json',
      },
      body: '{}',
    })
  );
  expect(response.status).toBe(503);
  expect(m.createClient).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
  expect(m.after).not.toHaveBeenCalled();
});
