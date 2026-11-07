// @vitest-environment node

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../..');
// Loading the real worker module graphs is slow under a parallel full run.
const IMPORT_TIMEOUT_MS = 60_000;

// The env modules each VPS entrypoint pulls in when it actually runs
// (sync-jumia-orders.ts loads its dependencies lazily inside the CLI).
const entrypoints = [
  {
    wrapper: 'sync-jumia-orders.sh',
    load: async () => {
      await import('@/lib/supabase/service');
      await import('@/lib/jumia/order-sync');
      await import('@/lib/jumia/server-credential-client');
    },
  },
  {
    wrapper: 'process-import-jobs.sh',
    load: async () => {
      await import('./process-import-jobs');
    },
  },
];

function readWrapperProfile(wrapper: string) {
  const source = readFileSync(
    path.join(repoRoot, 'vps-workers/bin', wrapper),
    'utf8'
  );
  const match = source.match(
    /export BACI_WORKER_PROFILE="\$\{BACI_WORKER_PROFILE:-([a-z-]+)\}"/
  );
  return match?.[1];
}

function stubProductionWorkerEnv() {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('GITHUB_ACTIONS', 'false');
  vi.stubEnv('GITHUB_REPOSITORY', '');
  vi.stubEnv('GITHUB_RUN_ID', '');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-key');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://supabase.example.com');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key');
  vi.stubEnv('SUPABASE_JWT_SECRET', 'jwt-secret');
  vi.stubEnv('QUIZ_PHASE', '1a');
  delete process.env.QUIZ_RPC_SERVER_SECRET;
  delete process.env.BACI_WORKER_PROFILE;
}

describe('bugfix: VPS worker entrypoints crashed on the negotiated-checkout quiz secret', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    stubProductionWorkerEnv();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it.each(entrypoints)(
    'boots $wrapper in production without QUIZ_RPC_SERVER_SECRET under its wrapper profile',
    async ({ wrapper, load }) => {
      const profile = readWrapperProfile(wrapper);
      expect(profile).toBeTruthy();
      vi.stubEnv('BACI_WORKER_PROFILE', profile);

      await expect(load()).resolves.toBeUndefined();
    },
    IMPORT_TIMEOUT_MS
  );

  it.each(entrypoints)(
    'still rejects $wrapper dependencies without a worker profile, like the web app',
    async ({ load }) => {
      await expect(load()).rejects.toThrow(
        /QUIZ_RPC_SERVER_SECRET is required in production for negotiated checkout proofs/
      );
    },
    IMPORT_TIMEOUT_MS
  );
});
