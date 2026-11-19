// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function stubWorkerBaseEnv() {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('GITHUB_ACTIONS', 'false');
  vi.stubEnv('GITHUB_REPOSITORY', '');
  vi.stubEnv('GITHUB_RUN_ID', '');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-key');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://supabase.example.com');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key');
  vi.stubEnv('QUIZ_PHASE', '1a');
  delete process.env.QUIZ_RPC_SERVER_SECRET;
  delete process.env.SUPABASE_JWT_SECRET;
  delete process.env.SUPABASE_AGENTIC_JWT_PRIVATE_JWK;
  delete process.env.BACI_WORKER_PROFILE;
}

describe('worker profile env validation', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    stubWorkerBaseEnv();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it.each([
    'cart-events',
    'gigl-tracking',
    'import-jobs',
    'jumia-order-sync',
    'merchant-onboarding-emails',
    'petrock-reconciliation',
    'piggyvest-webhook-capture-drain',
    'quiz-finalization',
  ])('allows the %s worker profile without unrelated agentic signing material or quiz proof secret', async (workerProfile) => {
    vi.stubEnv('BACI_WORKER_PROFILE', workerProfile);

    await expect(import('@/env')).resolves.toBeDefined();
  });
});
