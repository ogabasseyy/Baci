import { afterEach, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }));
vi.mock('@/env', () => ({
  getSupabaseUrl: () => 'https://db.example.test',
  getSupabaseAnonKey: () => 'synthetic-public-key',
}));

import { connectOxygenRuntime } from './runtime-connection';

function configure() {
  for (const [name, value] of Object.entries({
    VERCEL_ENV: 'preview',
    OXYGEN_STAGING_PARTNER_REFERENCE: 'partner',
    OXYGEN_STAGING_PARTNER_SECRET: 'synthetic-secret',
    OXYGEN_STAGING_WORKER_EMAIL: 'worker@example.test',
    OXYGEN_STAGING_WORKER_PASSWORD: 'synthetic-password',
    OXYGEN_STAGING_HOSTED_HOSTS: 'hosted.example.test',
    OXYGEN_DRAFT_ENCRYPTION_KEY: 'a'.repeat(64),
  }))
    vi.stubEnv(name, value);
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('retries a failed login only on a later call without sending the original provider request', async () => {
  configure();
  let logins = 0;
  let calls = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (String(url).endsWith('/partner/login')) {
        logins++;
        return logins === 1
          ? new Response(null, { status: 503 })
          : Response.json({ token: 'second', expires_in: 300 });
      }
      calls++;
      return Response.json({ ok: true });
    })
  );
  const runtime = connectOxygenRuntime();
  if (!runtime) throw new Error('missing runtime');
  await expect(runtime.provider.call('kyc', {})).rejects.toMatchObject({
    outcome: 'not_sent',
  });
  expect(calls).toBe(0);
  await expect(runtime.provider.call('kyc', {})).resolves.toEqual({ ok: true });
  expect(logins).toBe(2);
  expect(calls).toBe(1);
});

it('shares concurrent login and refreshes before token expiry', async () => {
  configure();
  let time = 1_000_000;
  vi.spyOn(Date, 'now').mockImplementation(() => time);
  let logins = 0;
  const authorizations: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith('/partner/login')) {
        logins++;
        return Response.json({ token: `token-${logins}`, expires_in: 90 });
      }
      authorizations.push(
        (init?.headers as Record<string, string>).Authorization
      );
      return Response.json({ ok: true });
    })
  );
  const runtime = connectOxygenRuntime();
  if (!runtime) throw new Error('missing runtime');
  await Promise.all([
    runtime.provider.call('kyc', {}),
    runtime.provider.call('kyc', {}),
  ]);
  expect(logins).toBe(1);
  time += 59_999;
  await runtime.provider.call('kyc', {});
  expect(logins).toBe(1);
  time += 1;
  await Promise.all([
    runtime.provider.call('kyc', {}),
    runtime.provider.call('kyc', {}),
  ]);
  expect(logins).toBe(2);
  expect(authorizations).toEqual([
    'Bearer token-1',
    'Bearer token-1',
    'Bearer token-1',
    'Bearer token-2',
    'Bearer token-2',
  ]);
});
