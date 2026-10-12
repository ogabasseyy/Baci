import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import { afterEach, expect, it, vi } from 'vitest';

const gate = vi.hoisted(() => vi.fn());
vi.mock('./customer-savings-draft-runtime-gate', () => ({
  customerSavingsDraftRuntimeEnabled: gate,
}));

import { customerSavingsDraftRequest } from './customer-savings-draft-request';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

it('passes the exact request identity and a key digest to the existing gate', () => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('BACI_WORKER_PROFILE', 'hosted-savings-drafts');
  vi.stubEnv('PIGGYVEST_HOSTED_DRAFT_STAGING_ENABLED', 'true');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://staging-auth.ogabassey.com');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'synthetic-public-key');
  gate.mockReturnValue(true);
  const request = new NextRequest('https://localhost:4792/example', {
    headers: {
      host: 'staging.ogabassey.com',
      'x-forwarded-host': 'staging.ogabassey.com',
      'x-forwarded-proto': 'https',
    },
  });
  expect(customerSavingsDraftRequest.enabled(request)).toBe(true);
  expect(gate).toHaveBeenCalledWith({
    requestOrigin: 'https://localhost:4792',
    nodeEnv: 'production',
    workerProfile: 'hosted-savings-drafts',
    stagingEnabled: 'true',
    supabaseUrl: 'https://staging-auth.ogabassey.com',
    supabaseAnonKeySha256: createHash('sha256')
      .update('synthetic-public-key')
      .digest('hex'),
    host: 'staging.ogabassey.com',
    forwardedHost: 'staging.ogabassey.com',
    forwardedProto: 'https',
  });
});

it('returns a non-cacheable generic failure and retains the synthetic tenant pin', async () => {
  const response = customerSavingsDraftRequest.failure(
    503,
    'SAVINGS_DRAFT_UNAVAILABLE'
  );
  expect(response.status).toBe(503);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.json()).toEqual({
    error: 'Savings draft unavailable',
    code: 'SAVINGS_DRAFT_UNAVAILABLE',
  });
  expect(customerSavingsDraftRequest.merchantId).toBe(
    '10000000-0000-4000-8000-000000000001'
  );
});
