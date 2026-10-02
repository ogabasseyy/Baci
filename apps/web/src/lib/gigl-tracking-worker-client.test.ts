import { createClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createGiglTrackingWorkerClient } from './gigl-tracking-worker-client';

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
  GIGL_TRACKING_WORKER_TOKEN: token('gigl_tracking_worker'),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
  NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
};

describe('createGiglTrackingWorkerClient', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uses the restricted worker JWT as PostgREST authorization', () => {
    const client = createGiglTrackingWorkerClient(configuredEnv);

    expect(createClient).toHaveBeenCalledWith(
      'https://project.supabase.co',
      'anon-key',
      expect.objectContaining({
        global: {
          headers: {
            Authorization: `Bearer ${configuredEnv.GIGL_TRACKING_WORKER_TOKEN}`,
          },
        },
      })
    );

    client.rpc('claim_due_gigl_tracking_monitors', {
      p_limit: 25,
      p_worker_id: 'worker-id',
    });

    expect(rpc).toHaveBeenCalledWith(
      'gigl_worker_claim_due_tracking_monitors',
      { p_limit: 25, p_worker_id: 'worker-id' },
      undefined
    );
  });

  it('rejects a service-role JWT before constructing a client', () => {
    expect(() =>
      createGiglTrackingWorkerClient({
        ...configuredEnv,
        GIGL_TRACKING_WORKER_TOKEN: token('service_role'),
      })
    ).toThrow('GIGL tracking worker database capability is invalid');
    expect(createClient).not.toHaveBeenCalled();
  });

  it('rejects unsigned and unsupported JWT algorithms', () => {
    for (const alg of ['none', 'RS256']) {
      expect(() =>
        createGiglTrackingWorkerClient({
          ...configuredEnv,
          GIGL_TRACKING_WORKER_TOKEN: token('gigl_tracking_worker', alg),
        })
      ).toThrow('GIGL tracking worker database capability is invalid');
    }
    expect(createClient).not.toHaveBeenCalled();
  });

  it('accepts a worker token inside its final 24 hours until expiry', () => {
    const client = createGiglTrackingWorkerClient({
      ...configuredEnv,
      GIGL_TRACKING_WORKER_TOKEN: token(
        'gigl_tracking_worker',
        'ES256',
        Math.floor(Date.now() / 1000) + 60 * 60
      ),
    });

    expect(createClient).toHaveBeenCalledOnce();
    expect(client).toBeDefined();
  });

  it('rejects an expired worker token', () => {
    expect(() =>
      createGiglTrackingWorkerClient({
        ...configuredEnv,
        GIGL_TRACKING_WORKER_TOKEN: token(
          'gigl_tracking_worker',
          'ES256',
          Math.floor(Date.now() / 1000) - 60
        ),
      })
    ).toThrow('GIGL tracking worker database capability is invalid');
    expect(createClient).not.toHaveBeenCalled();
  });

  it('rejects plaintext and credential-bearing Supabase URLs', () => {
    for (const supabaseUrl of [
      'http://project.supabase.co',
      'https://user:pass@project.supabase.co',
      'https://user@project.supabase.co',
    ]) {
      expect(() =>
        createGiglTrackingWorkerClient({
          ...configuredEnv,
          NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
        })
      ).toThrow(
        'GIGL tracking worker Supabase URL must be a credential-free https:// URL'
      );
    }
    expect(() =>
      createGiglTrackingWorkerClient({
        ...configuredEnv,
        NEXT_PUBLIC_SUPABASE_URL: 'not-a-url',
      })
    ).toThrow('GIGL tracking worker database capability is invalid');
    expect(createClient).not.toHaveBeenCalled();
  });

  it('rejects operations outside the reviewed five-wrapper capability', () => {
    const client = createGiglTrackingWorkerClient(configuredEnv);

    expect(() => client.rpc('unreviewed_operation' as never)).toThrow(
      'Unsupported GIGL tracking database operation'
    );
    expect(rpc).not.toHaveBeenCalled();
  });
});
