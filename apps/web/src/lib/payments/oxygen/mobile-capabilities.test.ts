import { beforeEach, expect, it, vi } from 'vitest';
import { readOxygenMobileCapabilities } from './mobile-capabilities';

const id = 'faea0000-0000-4000-8000-000000000011';
const row = {
  merchant_id: id,
  merchant_slug: 'test-store',
  environment: 'staging',
  binding_ready: true,
};
type RpcResponse = {
  data: unknown;
  error: { code?: string; message?: string } | null;
};

function mockStagingRpc(
  readinessResult: RpcResponse = { data: [row], error: null },
  settingsResult: RpcResponse = {
    data: [{ oxygen_enabled: true }],
    error: null,
  }
) {
  return vi.fn((name: string): Promise<RpcResponse> => {
    if (name === 'oxygen_mobile_staging_readiness') {
      return Promise.resolve(readinessResult);
    }
    if (name === 'get_storefront_payment_settings') {
      return Promise.resolve(settingsResult);
    }
    return Promise.resolve({ data: null, error: null });
  });
}
beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv('VERCEL_ENV', 'preview');
  vi.stubEnv('OXYGEN_ENVIRONMENT', 'staging');
  vi.stubEnv('OXYGEN_STAGING_MOBILE_ENABLED', 'true');
  for (const [key, value] of Object.entries({
    OXYGEN_STAGING_PARTNER_REFERENCE: 'synthetic-partner',
    OXYGEN_STAGING_PARTNER_SECRET: 'synthetic-secret',
    OXYGEN_STAGING_WORKER_EMAIL: 'worker@example.test',
    OXYGEN_STAGING_WORKER_PASSWORD: 'synthetic-password',
    OXYGEN_DRAFT_ENCRYPTION_KEY: 'a'.repeat(64),
  }))
    vi.stubEnv(key, value);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://test.supabase.co');
  vi.stubEnv(
    'OXYGEN_STAGING_HOSTED_HOSTS',
    'hosted.example.test,selfie.example.test'
  );
  vi.stubEnv('OXYGEN_STAGING_SELFIE_HOSTS', 'selfie.example.test');
});
it('reads only the owned readiness projection and returns safe metadata', async () => {
  const rpc = mockStagingRpc();
  const result = await readOxygenMobileCapabilities({ rpc }, 'test-store');
  expect(rpc).toHaveBeenNthCalledWith(1, 'oxygen_mobile_staging_readiness', {
    p_merchant_slug: 'test-store',
  });
  expect(rpc).toHaveBeenNthCalledWith(2, 'get_storefront_payment_settings', {
    p_merchant_id: id,
  });
  expect(result).toMatchObject({
    ok: true,
    capabilities: {
      schemaVersion: 1,
      mobileEnabled: true,
      authOrigin: 'https://test.supabase.co',
      merchant: { id, slug: 'test-store' },
      reason: null,
      selfieOrigins: ['https://selfie.example.test'],
    },
  });
});

it('disables staging mobile capability when oxygen_enabled is false', async () => {
  const rpc = mockStagingRpc(undefined, {
    data: [{ oxygen_enabled: false }],
    error: null,
  });
  await expect(
    readOxygenMobileCapabilities({ rpc }, 'test-store')
  ).resolves.toMatchObject({
    ok: true,
    capabilities: {
      mobileEnabled: false,
      reason: 'Oxygen is disabled for this storefront.',
    },
  });
});

it('fails closed (503) when get_storefront_payment_settings fails in staging', async () => {
  const rpc = mockStagingRpc(undefined, {
    data: null,
    error: { message: 'rpc failed' },
  });
  await expect(
    readOxygenMobileCapabilities({ rpc }, 'test-store')
  ).resolves.toEqual({
    ok: false,
    status: 503,
  });
});
it.each([
  { settingsRows: [] },
  { settingsRows: [{ oxygen_enabled: true }, { oxygen_enabled: false }] },
  { settingsRows: [{}] },
])('fails closed (503) when get_storefront_payment_settings returns invalid row set %o in staging', async ({
  settingsRows,
}) => {
  const rpc = mockStagingRpc(undefined, {
    data: settingsRows,
    error: null,
  });
  await expect(
    readOxygenMobileCapabilities({ rpc }, 'test-store')
  ).resolves.toEqual({
    ok: false,
    status: 503,
  });
});
it.each([
  'false',
  'TRUE',
  '1',
  '',
])('requires exact rollout flag (%s)', async (flag) => {
  vi.stubEnv('OXYGEN_STAGING_MOBILE_ENABLED', flag);
  expect(
    await readOxygenMobileCapabilities(
      { rpc: vi.fn().mockResolvedValue({ data: [row], error: null }) },
      'test-store'
    )
  ).toMatchObject({
    ok: true,
    capabilities: {
      mobileEnabled: false,
      hostedOrigins: [
        'https://hosted.example.test',
        'https://selfie.example.test',
      ],
    },
  });
});
it.each([
  { ...row, binding_ready: false },
  { ...row, environment: 'production' },
])('disables a mismatched or disabled binding', async (value) => {
  expect(
    await readOxygenMobileCapabilities(
      { rpc: vi.fn().mockResolvedValue({ data: [value], error: null }) },
      'test-store'
    )
  ).toMatchObject({ ok: true, capabilities: { mobileEnabled: false } });
});
it('never enables production', async () => {
  vi.stubEnv('VERCEL_ENV', 'production');
  vi.stubEnv('OXYGEN_ENVIRONMENT', 'production');
  expect(
    await readOxygenMobileCapabilities(
      {
        rpc: vi.fn().mockResolvedValue({
          data: [{ ...row, environment: 'production' }],
          error: null,
        }),
      },
      'test-store'
    )
  ).toMatchObject({
    ok: true,
    capabilities: { environment: 'production', mobileEnabled: false },
  });
});
it('returns denied for a missing customer binding without exposing merchant existence', async () => {
  expect(
    await readOxygenMobileCapabilities(
      { rpc: vi.fn().mockResolvedValue({ data: [], error: null }) },
      'test-store'
    )
  ).toEqual({ ok: false, status: 404 });
});
it.each([
  { data: null, error: { code: '42501' } },
  { data: [{ ...row, merchant_slug: 'other' }], error: null },
  { data: [{ ...row, worker_user_id: id }], error: null },
])('fails closed on unavailable or malformed policy', async (value) => {
  expect(
    await readOxygenMobileCapabilities(
      { rpc: vi.fn().mockResolvedValue(value) },
      'test-store'
    )
  ).toEqual({ ok: false, status: 503 });
});
it('rejects invalid slug before RPC and returns unavailable for invalid auth configuration', async () => {
  const rpc = vi.fn();
  expect(await readOxygenMobileCapabilities({ rpc }, 'bad/slug')).toEqual({
    ok: false,
    status: 400,
  });
  expect(rpc).not.toHaveBeenCalled();
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://test.supabase.co/path');
  rpc.mockResolvedValue({ data: [row], error: null });
  expect(await readOxygenMobileCapabilities({ rpc }, 'test-store')).toEqual({
    ok: false,
    status: 503,
  });
});
it('handles RPC exceptions without details', async () => {
  expect(
    await readOxygenMobileCapabilities(
      { rpc: vi.fn().mockRejectedValue(new Error('secret')) },
      'test-store'
    )
  ).toEqual({ ok: false, status: 503 });
});
it('disables initiation when server runtime configuration is unavailable', async () => {
  vi.stubEnv('OXYGEN_STAGING_PARTNER_REFERENCE', '');
  expect(
    await readOxygenMobileCapabilities(
      { rpc: vi.fn().mockResolvedValue({ data: [row], error: null }) },
      'test-store'
    )
  ).toMatchObject({ ok: true, capabilities: { mobileEnabled: false } });
});
it.each([
  'localhost',
  '127.0.0.1',
  '[::1]',
])('pins a development-only %s QA auth base independently from its origin', async (host) => {
  vi.stubEnv('VERCEL_ENV', 'development');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', `http://${host}:3000/qa-backend`);
  const result = await readOxygenMobileCapabilities(
    { rpc: mockStagingRpc() },
    'test-store'
  );
  expect(result).toMatchObject({
    ok: true,
    capabilities: {
      authOrigin: `http://${host}:3000`,
      authBaseUrl: `http://${host}:3000/qa-backend`,
      mobileEnabled: true,
    },
  });
});
it('keeps secure root Auth configuration exact', async () => {
  expect(
    await readOxygenMobileCapabilities({ rpc: mockStagingRpc() }, 'test-store')
  ).toMatchObject({
    ok: true,
    capabilities: {
      authOrigin: 'https://test.supabase.co',
      authBaseUrl: 'https://test.supabase.co',
    },
  });
});
it.each([
  'http://localhost:3000/arbitrary',
  'http://localhost:3000/qa-backend/',
  'http://localhost:3000/qa-backend?query=secret',
  'http://localhost:3000/qa-backend#fragment',
  'http://user:pass@localhost:3000/qa-backend',
  'http://localhost.evil.test:3000/qa-backend',
  'https://test.supabase.co/qa-backend',
  'http://localhost:3000/a/../qa-backend',
  'http://LOCALHOST:3000/qa-backend',
  'http://127.1:3000/qa-backend',
])('rejects unexpected Auth base without laundering it into an origin: %s', async (auth) => {
  vi.stubEnv('VERCEL_ENV', 'development');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', auth);
  expect(
    await readOxygenMobileCapabilities(
      { rpc: vi.fn().mockResolvedValue({ data: [row], error: null }) },
      'test-store'
    )
  ).toEqual({ ok: false, status: 503 });
});
it.each([
  'production',
])('does not accept QA auth proxy on %s deployment', async (deployment) => {
  vi.stubEnv('VERCEL_ENV', deployment);
  vi.stubEnv(
    'OXYGEN_ENVIRONMENT',
    deployment === 'production' ? 'production' : 'staging'
  );
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://localhost:3000/qa-backend');
  expect(
    await readOxygenMobileCapabilities(
      { rpc: vi.fn().mockResolvedValue({ data: [row], error: null }) },
      'test-store'
    )
  ).toEqual({ ok: false, status: 503 });
});

it('accepts preview metadata only in an explicit development or test loopback runtime', async () => {
  vi.stubEnv('VERCEL_ENV', 'preview');
  vi.stubEnv('NODE_ENV', 'development');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://localhost:3000/qa-backend');
  expect(
    await readOxygenMobileCapabilities({ rpc: mockStagingRpc() }, 'test-store')
  ).toMatchObject({
    ok: true,
    capabilities: {
      authOrigin: 'http://localhost:3000',
      authBaseUrl: 'http://localhost:3000/qa-backend',
    },
  });
  vi.stubEnv('NODE_ENV', 'production');
  expect(
    await readOxygenMobileCapabilities(
      { rpc: vi.fn().mockResolvedValue({ data: [row], error: null }) },
      'test-store'
    )
  ).toEqual({ ok: false, status: 503 });
});
