import { createClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createGiglTrackingWorkerClient } from './gigl-tracking-worker-client';

// Split from gigl-tracking-worker-client.test.ts to keep both suites
// under the 300-line limit; the mock, token builder, and env are
// intentionally duplicated (per-file vi.mock, no shared test-only
// module to drift from either suite).
const rpc = vi.fn();
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ rpc })),
}));

function token(role: string, alg = 'ES256', exp = 4_102_444_800) {
  const header = Buffer.from(JSON.stringify({ alg, typ: 'JWT' })).toString(
    'base64url'
  );
  const payload = Buffer.from(JSON.stringify({ exp, role })).toString(
    'base64url'
  );
  return `${header}.${payload}.signature`;
}

const configuredEnv = {
  GIGL_SUPABASE_ORIGIN_ALLOWLIST: 'project.supabase.co',
  GIGL_TRACKING_WORKER_TOKEN: token('gigl_tracking_worker'),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
  NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
};

describe('createGiglTrackingWorkerClient production origin pin', () => {
  beforeEach(() => vi.clearAllMocks());

  it('ignores the origin allowlist when NODE_ENV is production', () => {
    // The VPS scoped runner forwards every GIGL_* variable, so a
    // stale preview allowlist entry plus a mistyped URL would send
    // the worker JWT to a host that can replay it against
    // production. Production pins to the expected host exactly.
    expect(() =>
      createGiglTrackingWorkerClient({
        ...configuredEnv,
        NODE_ENV: 'production',
      })
    ).toThrow(
      'GIGL tracking worker Supabase URL host is not an allowed origin'
    );
    expect(createClient).not.toHaveBeenCalled();
  });

  it('matches NODE_ENV case-insensitively with whitespace tolerance', () => {
    expect(() =>
      createGiglTrackingWorkerClient({
        ...configuredEnv,
        NODE_ENV: ' Production ',
      })
    ).toThrow(
      'GIGL tracking worker Supabase URL host is not an allowed origin'
    );
    expect(createClient).not.toHaveBeenCalled();
  });

  it('accepts the pinned host in production despite the allowlist', () => {
    const client = createGiglTrackingWorkerClient({
      ...configuredEnv,
      NEXT_PUBLIC_SUPABASE_URL: 'https://aivqthbxdshhltbwipbr.supabase.co',
      NODE_ENV: 'production',
    });

    expect(createClient).toHaveBeenCalledOnce();
    expect(client).toBeDefined();
  });

  it('honors the allowlist outside production', () => {
    for (const nodeEnv of [undefined, 'development', 'test']) {
      vi.clearAllMocks();
      const client = createGiglTrackingWorkerClient({
        ...configuredEnv,
        NODE_ENV: nodeEnv,
      });

      expect(createClient).toHaveBeenCalledOnce();
      expect(client).toBeDefined();
    }
  });
});
