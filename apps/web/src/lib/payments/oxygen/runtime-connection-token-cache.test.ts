import { afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }));
vi.mock('@/env', () => ({
  getSupabaseUrl: () => 'https://db.example.test',
  getSupabaseAnonKey: () => 'synthetic-public-key',
}));

beforeEach(() => {
  vi.resetModules();
});

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
  const { connectOxygenRuntime } = await import('./runtime-connection');
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
  const { connectOxygenRuntime } = await import('./runtime-connection');
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

it('reuses one partner token across sequential independent connections for the same trusted identity', async () => {
  configure();
  let logins = 0;
  const fetcher = vi.fn(async (url: string) =>
    String(url).endsWith('/partner/login')
      ? Response.json({ token: `token-${++logins}`, expires_in: 300 })
      : Response.json({ ok: true })
  );
  vi.stubGlobal('fetch', fetcher);
  const { connectOxygenRuntime } = await import('./runtime-connection');
  const first = connectOxygenRuntime();
  const second = connectOxygenRuntime();
  if (!first || !second) throw new Error('missing runtime');
  await first.provider.call('kyc', {});
  await second.provider.call('kyc', {});
  expect(logins).toBe(1);
  expect(fetcher).toHaveBeenCalledTimes(3);
});

it('refreshes a shared identity before expiry across separate connections', async () => {
  configure();
  let now = 1_000_000;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  let logins = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      String(url).endsWith('/partner/login')
        ? Response.json({ token: `token-${++logins}`, expires_in: 90 })
        : Response.json({ ok: true })
    )
  );
  const { connectOxygenRuntime } = await import('./runtime-connection');
  const first = connectOxygenRuntime();
  const second = connectOxygenRuntime();
  if (!first || !second) throw new Error('missing runtime');
  await first.provider.call('kyc', {});
  now += 59_999;
  await second.provider.call('kyc', {});
  expect(logins).toBe(1);
  now += 1;
  await second.provider.call('kyc', {});
  expect(logins).toBe(2);
});

it('isolates token caches by environment, partner and rotated credential', async () => {
  configure();
  let logins = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      String(url).endsWith('/partner/login')
        ? Response.json({ token: `token-${++logins}`, expires_in: 300 })
        : Response.json({ ok: true })
    )
  );
  const { connectOxygenRuntime } = await import('./runtime-connection');
  const first = connectOxygenRuntime();
  vi.stubEnv('OXYGEN_STAGING_PARTNER_REFERENCE', 'other-partner');
  const second = connectOxygenRuntime();
  vi.stubEnv('OXYGEN_STAGING_PARTNER_SECRET', 'rotated-secret');
  const third = connectOxygenRuntime();
  for (const [name, value] of Object.entries({
    VERCEL_ENV: 'production',
    OXYGEN_PRODUCTION_RUNTIME_ENABLED: 'true',
    OXYGEN_PRODUCTION_PARTNER_REFERENCE: 'partner',
    OXYGEN_PRODUCTION_PARTNER_SECRET: 'synthetic-secret',
    OXYGEN_PRODUCTION_WORKER_EMAIL: 'worker@example.test',
    OXYGEN_PRODUCTION_WORKER_PASSWORD: 'synthetic-password',
    OXYGEN_PRODUCTION_HOSTED_HOSTS: 'hosted.example.test',
    OXYGEN_PRODUCTION_DRAFT_ENCRYPTION_KEY: 'b'.repeat(64),
  }))
    vi.stubEnv(name, value);
  const production = connectOxygenRuntime();
  if (!first || !second || !third || !production)
    throw new Error('missing runtime');
  await first.provider.call('kyc', {});
  await second.provider.call('kyc', {});
  await third.provider.call('kyc', {});
  await production.provider.call('kyc', {});
  expect(logins).toBe(4);
});

it('coalesces concurrent failed logins across connections and retries only on a later call', async () => {
  configure();
  let release!: (value: Response) => void;
  const pending = new Promise<Response>((resolve) => {
    release = resolve;
  });
  let logins = 0;
  let providerCalls = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (String(url).endsWith('/partner/login')) {
        logins++;
        return logins === 1
          ? pending
          : Response.json({ token: 'later', expires_in: 300 });
      }
      providerCalls++;
      return Response.json({ ok: true });
    })
  );
  const { connectOxygenRuntime } = await import('./runtime-connection');
  const first = connectOxygenRuntime();
  const second = connectOxygenRuntime();
  if (!first || !second) throw new Error('missing runtime');
  const outcomes = Promise.allSettled([
    first.provider.call('kyc', {}),
    second.provider.call('kyc', {}),
  ]);
  await vi.waitFor(() => expect(logins).toBe(1));
  release(new Response(null, { status: 503 }));
  expect(
    (await outcomes).every((outcome) => outcome.status === 'rejected')
  ).toBe(true);
  expect(providerCalls).toBe(0);
  await second.provider.call('kyc', {});
  expect(logins).toBe(2);
  expect(providerCalls).toBe(1);
});
