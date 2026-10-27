// @vitest-environment node

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
}

function loadEnvModule() {
  vi.resetModules();
  return import('@/env');
}

describe('address autocomplete KV environment credentials', () => {
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

  it('normalizes the credential pair in the validated server environment', async () => {
    vi.stubEnv(
      'ADDRESS_AUTOCOMPLETE_KV_REST_API_URL',
      ' https://address-kv.example.com '
    );
    vi.stubEnv('ADDRESS_AUTOCOMPLETE_KV_REST_API_TOKEN', ' address-kv-token ');

    const { env } = await loadEnvModule();
    expect(env).toMatchObject({
      ADDRESS_AUTOCOMPLETE_KV_REST_API_URL: 'https://address-kv.example.com',
      ADDRESS_AUTOCOMPLETE_KV_REST_API_TOKEN: 'address-kv-token',
    });
  });

  it.each([
    ['https://address-kv.example.com', ''],
    ['', 'address-kv-token'],
  ])('rejects a partial credential pair %s/%s', async (url, token) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('SUPABASE_JWT_SECRET', 'valid-test-signing-secret');
    vi.stubEnv('ADDRESS_AUTOCOMPLETE_KV_REST_API_URL', url);
    vi.stubEnv('ADDRESS_AUTOCOMPLETE_KV_REST_API_TOKEN', token);

    await expect(loadEnvModule()).rejects.toThrow(
      'ADDRESS_AUTOCOMPLETE_KV_REST_API'
    );
  });

  it('omits KV credentials from client environment exports', async () => {
    vi.stubGlobal('window', {});
    vi.stubEnv(
      'ADDRESS_AUTOCOMPLETE_KV_REST_API_URL',
      'https://address-kv.example.com'
    );
    vi.stubEnv('ADDRESS_AUTOCOMPLETE_KV_REST_API_TOKEN', 'private-test-token');

    const { env } = await loadEnvModule();
    expect(env.ADDRESS_AUTOCOMPLETE_KV_REST_API_URL).toBeUndefined();
    expect(env.ADDRESS_AUTOCOMPLETE_KV_REST_API_TOKEN).toBeUndefined();
  });
});
