// @vitest-environment node

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function stubBaseEnv() {
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('GITHUB_ACTIONS', 'false');
  vi.stubEnv('GITHUB_REPOSITORY', '');
  vi.stubEnv('GITHUB_RUN_ID', '');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-key');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://supabase.example.com');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key');
  vi.stubEnv('QUIZ_RPC_SERVER_SECRET', 'quiz-test-secret');
  delete process.env.SUPABASE_JWT_SECRET;
  delete process.env.SUPABASE_AGENTIC_JWT_PRIVATE_JWK;
  delete process.env.BACI_WORKER_PROFILE;
  delete process.env.WALLET_PIN_PEPPER;
}

function loadEnvModule() {
  vi.resetModules();
  return import('@/env');
}

describe('WALLET_PIN_PEPPER environment declaration', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    stubBaseEnv();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('is optional: unset keeps the PIN feature off', async () => {
    const { env } = await loadEnvModule();
    expect(env.WALLET_PIN_PEPPER).toBeUndefined();
  });

  it('exposes the trimmed pepper to server code', async () => {
    vi.stubEnv('WALLET_PIN_PEPPER', `  ${'abcdefghij'.repeat(4)}  `);
    const { env } = await loadEnvModule();
    expect(env.WALLET_PIN_PEPPER).toBe('abcdefghij'.repeat(4));
  });

  // The PIN feature is optional and dark: a mistyped pepper must switch only
  // the PIN routes off (they read it through getWalletPinPepperState and
  // answer 503), never take every page that imports @/env down at runtime.
  it('never fails a production boot when the pepper is unusable', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('SUPABASE_JWT_SECRET', 'valid-test-signing-secret');
    vi.stubEnv('WALLET_PIN_PEPPER', 'short-secret-value');

    const { env } = await loadEnvModule();
    expect(env.WALLET_PIN_PEPPER).toBeUndefined();
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(
      'WALLET_PIN_PEPPER'
    );
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(
      'short-secret-value'
    );
  });

  it('is never part of the client environment', async () => {
    vi.stubGlobal('window', {});
    vi.stubEnv('WALLET_PIN_PEPPER', 'abcdefghij'.repeat(4));
    const { env } = await loadEnvModule();
    expect(env.WALLET_PIN_PEPPER).toBeUndefined();
  });
});

// The pepper is read at request time on the server. Naming it in turbo.json
// would put the secret in the build task's environment and cache key (the
// prebuilt build never sees its value), and every rotation would bust the
// build cache.
describe('WALLET_PIN_PEPPER and the Turborepo environment', () => {
  it('is named in no task, global or pass-through env list', () => {
    const turbo = readFileSync(
      fileURLToPath(new URL('../../../turbo.json', import.meta.url)),
      'utf8'
    );
    expect(turbo).not.toContain('WALLET_PIN_PEPPER');
  });
});
