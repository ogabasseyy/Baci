import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ createClient: vi.fn(), rpc: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({
  createClient: mocks.createClient,
}));

import {
  CacheInvalidationWorkerTokenError,
  createCacheInvalidationWorkerClient,
} from './cache-invalidation-worker-client';

function workerToken(claims: Record<string, unknown>): string {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(claims)}.signature`;
}

const validEnv = () => ({
  CACHE_INVALIDATION_WORKER_TOKEN: workerToken({
    exp: Math.floor(Date.now() / 1000) + 3600,
    role: 'cache_invalidation_worker',
  }),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
  NEXT_PUBLIC_SUPABASE_URL: 'https://aivqthbxdshhltbwipbr.supabase.co',
  NODE_ENV: 'production',
});

describe('createCacheInvalidationWorkerClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createClient.mockReturnValue({ rpc: mocks.rpc });
  });

  it('sends only the three allowed RPCs with the worker bearer token', () => {
    const env = validEnv();
    const client = createCacheInvalidationWorkerClient(env);
    expect(client.rpc('claim_cache_invalidations', { p_batch_size: 5 })).toBe(
      undefined
    );
    expect(mocks.createClient).toHaveBeenCalledWith(
      env.NEXT_PUBLIC_SUPABASE_URL,
      env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      expect.objectContaining({
        global: {
          headers: {
            Authorization: `Bearer ${env.CACHE_INVALIDATION_WORKER_TOKEN}`,
          },
        },
      })
    );
    expect(mocks.rpc).toHaveBeenCalledWith(
      'claim_cache_invalidations',
      {
        p_batch_size: 5,
      },
      undefined
    );
  });

  it('rejects missing, expired, wrong-role, and malformed tokens', () => {
    for (const token of [
      undefined,
      workerToken({
        exp: Math.floor(Date.now() / 1000) - 1,
        role: 'cache_invalidation_worker',
      }),
      workerToken({
        exp: Math.floor(Date.now() / 1000) + 3600,
        role: 'service_role',
      }),
      'not-a-jwt',
    ]) {
      expect(() =>
        createCacheInvalidationWorkerClient({
          ...validEnv(),
          CACHE_INVALIDATION_WORKER_TOKEN: token,
        })
      ).toThrow(CacheInvalidationWorkerTokenError);
    }
  });

  it('pins production credentials to HTTPS and the production Supabase host', () => {
    expect(() =>
      createCacheInvalidationWorkerClient({
        ...validEnv(),
        NEXT_PUBLIC_SUPABASE_URL: 'http://aivqthbxdshhltbwipbr.supabase.co',
      })
    ).toThrow('credential-free https:// URL');
    expect(() =>
      createCacheInvalidationWorkerClient({
        ...validEnv(),
        NEXT_PUBLIC_SUPABASE_URL: 'https://attacker.example',
      })
    ).toThrow('not an allowed origin');
  });

  it('refuses every database operation outside the fixed RPC allowlist', () => {
    const client = createCacheInvalidationWorkerClient(validEnv());
    for (const name of ['products', 'rpc', 'replace_cache_invalidation']) {
      expect(() => client.rpc(name as never, {} as never)).toThrow(
        'Unsupported cache invalidation database operation'
      );
    }
  });

  it('keeps the cron route off the service-role client and scoped to the worker factory', () => {
    const route = readFileSync(
      join(__dirname, '../app/api/cron/drain-cache-invalidations/route.ts'),
      'utf8'
    );
    expect(route).toContain('createCacheInvalidationWorkerClient');
    expect(route).not.toContain('createServiceClient');
    expect(route).not.toContain("'event-pipeline'");
  });
});
