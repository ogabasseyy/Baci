import { NextRequest } from 'next/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  worker: vi.fn(),
  perform: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: vi.fn().mockResolvedValue({
    user: { id: 'synthetic-owner' },
    supabase: {},
  }),
}));
vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: vi.fn().mockResolvedValue({ valid: true }),
}));
vi.mock('@/lib/rate-limit', () => ({
  checkOxygenProviderRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
}));
vi.mock('@/lib/payments/oxygen/runtime-worker-client', () => ({
  createOxygenWorkerClient: mocks.worker,
}));
vi.mock('@/lib/payments/oxygen/runtime-service', () => ({
  performOxygenAction: mocks.perform,
  readOxygenSnapshot: vi.fn(),
}));

import { GET as drain } from '@/app/api/cron/oxygen-callback-reconciliation/route';
import { POST as webhook } from '@/app/api/payments/oxygen/webhook/route';
// Use the real runtime/callback configuration and connection factory: complete
// production credentials must not turn a disabled release into an active one.
import { readOxygenHostedOrigins } from '@/lib/payments/oxygen/oxygen-hosted-origins';
import { POST } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn());
  for (const [key, value] of Object.entries({
    VERCEL_ENV: 'production',
    CRON_SECRET: 'synthetic-cron-secret',
    OXYGEN_PRODUCTION_PARTNER_REFERENCE: 'synthetic-partner',
    OXYGEN_PRODUCTION_PARTNER_SECRET: 'synthetic-secret',
    OXYGEN_PRODUCTION_WORKER_EMAIL: 'worker@example.test',
    OXYGEN_PRODUCTION_WORKER_PASSWORD: 'synthetic-password',
    OXYGEN_PRODUCTION_DRAFT_ENCRYPTION_KEY: 'a'.repeat(64),
    OXYGEN_PRODUCTION_HOSTED_HOSTS: 'hosted.example.test',
    OXYGEN_PRODUCTION_SELFIE_HOSTS: 'hosted.example.test',
    OXYGEN_PRODUCTION_CALLBACK_KEY: 'synthetic-callback-key',
    OXYGEN_PRODUCTION_CALLBACK_SECRET: 'synthetic-callback-secret',
    OXYGEN_PRODUCTION_AUTOMATIC_ACTIVATION_ENABLED: 'true',
    OXYGEN_CALLBACK_DRAIN_ENABLED: 'true',
  }))
    vi.stubEnv(key, value);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it.each([
  '',
  'false',
  'TRUE',
  '1',
])('keeps actions, callbacks and drain inert when the runtime flag is %j', async (flag) => {
  vi.stubEnv('OXYGEN_PRODUCTION_RUNTIME_ENABLED', flag);
  const action = await POST(
    new NextRequest(
      'https://shop.example.test/api/payments/oxygen/workflows/actions',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workflowId: '60000000-0000-4000-8000-000000000001',
          idempotencyKey: '60000000-0000-4000-8000-000000000002',
          version: 1,
          command: { action: 'refresh_kyc' },
        }),
      }
    )
  );
  expect(action.status).toBe(503);
  expect(await action.json()).toEqual({
    error: 'Provider connection unavailable',
  });
  expect(action.headers.get('cache-control')).toBe('no-store');
  const callback = await webhook(
    new Request('https://shop.example.test/api/payments/oxygen/webhook', {
      method: 'POST',
    })
  );
  expect(callback.status).toBe(503);
  expect(await callback.json()).toEqual({ error: 'Callback unavailable' });
  expect(
    (
      await drain(
        new Request(
          'https://shop.example.test/api/cron/oxygen-callback-reconciliation',
          { headers: { authorization: 'Bearer synthetic-cron-secret' } }
        )
      )
    ).status
  ).toBe(503);
  expect(readOxygenHostedOrigins()).toEqual({ hosted: [], selfie: [] });
  expect(mocks.worker).not.toHaveBeenCalled();
  expect(mocks.perform).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});
