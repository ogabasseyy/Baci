import { beforeEach, expect, it, vi } from 'vitest';
import { readOxygenMobileCapabilities } from './mobile-capabilities';

const id = 'faea0000-0000-4000-8000-000000000011';
const binding = {
  merchant_id: id,
  merchant_slug: 'ogabassey',
  environment: 'production',
  binding_ready: true,
};

beforeEach(() => {
  vi.unstubAllEnvs();
  for (const [key, value] of Object.entries({
    VERCEL_ENV: 'production',
    OXYGEN_ENVIRONMENT: 'production',
    OXYGEN_PRODUCTION_RUNTIME_ENABLED: 'true',
    OXYGEN_PRODUCTION_MOBILE_ENABLED: 'true',
    OXYGEN_PRODUCTION_AUTOMATIC_ACTIVATION_ENABLED: 'true',
    OXYGEN_PRODUCTION_PARTNER_REFERENCE: 'synthetic-partner',
    OXYGEN_PRODUCTION_PARTNER_SECRET: 'synthetic-secret',
    OXYGEN_PRODUCTION_WORKER_EMAIL: 'worker@example.test',
    OXYGEN_PRODUCTION_WORKER_PASSWORD: 'synthetic-password',
    OXYGEN_PRODUCTION_DRAFT_ENCRYPTION_KEY: 'a'.repeat(64),
    OXYGEN_PRODUCTION_HOSTED_HOSTS: 'hosted.example.test',
    OXYGEN_PRODUCTION_SELFIE_HOSTS: 'hosted.example.test',
    NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
  }))
    vi.stubEnv(key, value);
});

function mockClient(admission: unknown, merchantSlug = 'ogabassey') {
  return {
    rpc: vi
      .fn()
      .mockResolvedValueOnce({
        data: [{ ...binding, merchant_slug: merchantSlug }],
        error: null,
      })
      .mockResolvedValueOnce(admission),
  };
}

it('requires an affirmative caller-scoped production admission result', async () => {
  const client = mockClient({ data: true, error: null });
  await expect(
    readOxygenMobileCapabilities(client, 'ogabassey')
  ).resolves.toMatchObject({
    ok: true,
    capabilities: { environment: 'production', mobileEnabled: true },
  });
  expect(client.rpc).toHaveBeenNthCalledWith(
    2,
    'oxygen_storefront_pilot_available',
    { p_merchant_id: id }
  );
});

it.each([
  false,
  null,
  'true',
])('keeps production off on non-affirmative admission %s', async (data) => {
  const client = mockClient({ data, error: null });
  await expect(
    readOxygenMobileCapabilities(client, 'ogabassey')
  ).resolves.toMatchObject({
    ok: true,
    capabilities: { mobileEnabled: false },
  });
});

it('reports unavailable when the production policy read fails', async () => {
  const client = mockClient({ data: null, error: { code: '42501' } });
  await expect(
    readOxygenMobileCapabilities(client, 'ogabassey')
  ).resolves.toEqual({
    ok: false,
    status: 503,
  });
});

it('never queries production admission for other storefronts', async () => {
  const client = mockClient({ data: true, error: null }, 'another-store');
  await expect(
    readOxygenMobileCapabilities(client, 'another-store')
  ).resolves.toMatchObject({
    ok: true,
    capabilities: { mobileEnabled: false },
  });
  expect(client.rpc).toHaveBeenCalledTimes(1);
});

it('keeps production off when the mobile switch is unset', async () => {
  vi.stubEnv('OXYGEN_PRODUCTION_MOBILE_ENABLED', '');
  const client = mockClient({ data: true, error: null });
  await expect(
    readOxygenMobileCapabilities(client, 'ogabassey')
  ).resolves.toMatchObject({
    ok: true,
    capabilities: { mobileEnabled: false },
  });
  expect(client.rpc).toHaveBeenCalledTimes(1);
});
