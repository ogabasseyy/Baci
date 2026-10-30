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

describe('address provider environment after Redis retirement', () => {
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

  it('continues to normalize the active address provider credentials', async () => {
    vi.stubEnv('GEOAPIFY_API_KEY', ' geo-test-key ');
    vi.stubEnv('GOOGLE_PLACES_API_KEY', ' google-test-key ');
    const { env } = await loadEnvModule();
    expect(env).toMatchObject({
      GEOAPIFY_API_KEY: 'geo-test-key',
      GOOGLE_PLACES_API_KEY: 'google-test-key',
    });
  });

  describe.each([
    'KV_REST_API',
    'REDIS_REST',
  ])('retired ADDRESS_AUTOCOMPLETE_%s configuration', (suffix) => {
    it.each([
      ['not-a-url', 'stale-token'],
      ['https://retired.example.test', ''],
      ['', 'stale-token'],
    ])('cannot block production boot with URL %s', async (url, token) => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('SUPABASE_JWT_SECRET', 'valid-test-signing-secret');
      vi.stubEnv(`ADDRESS_AUTOCOMPLETE_${suffix}_URL`, url);
      vi.stubEnv(`ADDRESS_AUTOCOMPLETE_${suffix}_TOKEN`, token);
      const { env } = await loadEnvModule();
      expect(env).not.toHaveProperty(`ADDRESS_AUTOCOMPLETE_${suffix}_URL`);
      expect(env).not.toHaveProperty(`ADDRESS_AUTOCOMPLETE_${suffix}_TOKEN`);
    });
  });

  it('excludes both active and retired provider secrets from the client', async () => {
    vi.stubGlobal('window', {});
    vi.stubEnv('GEOAPIFY_API_KEY', 'private-geo-key');
    vi.stubEnv('GOOGLE_PLACES_API_KEY', 'private-google-key');
    vi.stubEnv('ADDRESS_AUTOCOMPLETE_KV_REST_API_TOKEN', 'retired-token');
    vi.stubEnv('ADDRESS_AUTOCOMPLETE_REDIS_REST_TOKEN', 'retired-token');
    const { env } = await loadEnvModule();
    for (const key of [
      'GEOAPIFY_API_KEY',
      'GOOGLE_PLACES_API_KEY',
      'ADDRESS_AUTOCOMPLETE_KV_REST_API_TOKEN',
      'ADDRESS_AUTOCOMPLETE_REDIS_REST_TOKEN',
    ]) {
      expect(env).not.toHaveProperty(key);
    }
  });
});
