import { createClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createGiglTrackingWorkerClient,
  GiglWorkerTokenError,
  GiglWorkerTokenRoleError,
} from './gigl-tracking-worker-client';

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
    ).toThrow(
      'GIGL tracking worker token is a usable non-worker JWT; refusing to scope a privileged credential to the poller'
    );
    expect(createClient).not.toHaveBeenCalled();
  });

  it('rejects unsigned and unsupported JWT algorithms', () => {
    for (const alg of ['none', 'HS384']) {
      expect(() =>
        createGiglTrackingWorkerClient({
          ...configuredEnv,
          GIGL_TRACKING_WORKER_TOKEN: token('gigl_tracking_worker', alg),
        })
      ).toThrow('GIGL tracking worker database capability is invalid');
    }
    expect(createClient).not.toHaveBeenCalled();
  });

  it('treats RS256 tokens per Supabase RSA signing keys', () => {
    const client = createGiglTrackingWorkerClient({
      ...configuredEnv,
      GIGL_TRACKING_WORKER_TOKEN: token('gigl_tracking_worker', 'RS256'),
    });

    expect(createClient).toHaveBeenCalledOnce();
    expect(client).toBeDefined();

    expect(() =>
      createGiglTrackingWorkerClient({
        ...configuredEnv,
        GIGL_TRACKING_WORKER_TOKEN: token('service_role', 'RS256'),
      })
    ).toThrow(
      'GIGL tracking worker token is a usable non-worker JWT; refusing to scope a privileged credential to the poller'
    );
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

  it('accepts the pinned production origin without an allowlist', () => {
    const { GIGL_SUPABASE_ORIGIN_ALLOWLIST: _dropped, ...prodEnv } =
      configuredEnv;

    const client = createGiglTrackingWorkerClient({
      ...prodEnv,
      NEXT_PUBLIC_SUPABASE_URL: 'https://aivqthbxdshhltbwipbr.supabase.co',
    });

    expect(createClient).toHaveBeenCalledOnce();
    expect(client).toBeDefined();
  });

  it('rejects unlisted https origins before sending the worker token', () => {
    // A suffix check would pass attacker-project.supabase.co; only the
    // pinned host and explicit allowlist entries pass.
    for (const supabaseUrl of [
      'https://attacker.example',
      'https://attacker-project.supabase.co',
      'https://project.supabase.com',
    ]) {
      expect(() =>
        createGiglTrackingWorkerClient({
          ...configuredEnv,
          NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
        })
      ).toThrow(
        'GIGL tracking worker Supabase URL host is not an allowed origin'
      );
    }
    expect(createClient).not.toHaveBeenCalled();
  });

  it('matches allowlist entries case-insensitively with whitespace tolerance', () => {
    const client = createGiglTrackingWorkerClient({
      ...configuredEnv,
      GIGL_SUPABASE_ORIGIN_ALLOWLIST:
        ' other.supabase.co, PROJECT.supabase.co. ',
      NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
    });

    expect(createClient).toHaveBeenCalledOnce();
    expect(client).toBeDefined();
  });

  it('classifies token failures distinctly from config failures', () => {
    const capture = (build: () => unknown): unknown => {
      try {
        build();
      } catch (error) {
        return error;
      }
      throw new Error('expected construction to throw');
    };

    // Absent/expired/mis-issued tokens: the only vacuous class. An
    // expired non-worker JWT is unusable, so it stays vacuous too.
    expect(
      capture(() =>
        createGiglTrackingWorkerClient({
          ...configuredEnv,
          GIGL_TRACKING_WORKER_TOKEN: undefined,
        })
      )
    ).toBeInstanceOf(GiglWorkerTokenError);
    expect(
      capture(() =>
        createGiglTrackingWorkerClient({
          ...configuredEnv,
          GIGL_TRACKING_WORKER_TOKEN: token(
            'gigl_tracking_worker',
            'ES256',
            Math.floor(Date.now() / 1000) - 60
          ),
        })
      )
    ).toBeInstanceOf(GiglWorkerTokenError);
    expect(
      capture(() =>
        createGiglTrackingWorkerClient({
          ...configuredEnv,
          GIGL_TRACKING_WORKER_TOKEN: token(
            'service_role',
            'ES256',
            Math.floor(Date.now() / 1000) - 60
          ),
        })
      )
    ).toBeInstanceOf(GiglWorkerTokenError);
    // A usable (unexpired, acceptably signed) non-worker JWT is a live
    // credential, never vacuous: it must fail closed under its own
    // class so the disabled smoke cannot latch it as "missing".
    const roleError = capture(() =>
      createGiglTrackingWorkerClient({
        ...configuredEnv,
        GIGL_TRACKING_WORKER_TOKEN: token('service_role'),
      })
    );
    expect(roleError).toBeInstanceOf(GiglWorkerTokenRoleError);
    expect(roleError).not.toBeInstanceOf(GiglWorkerTokenError);
    // URL/anon failures fail closed, never vacuous.
    expect(
      capture(() =>
        createGiglTrackingWorkerClient({
          ...configuredEnv,
          NEXT_PUBLIC_SUPABASE_URL: 'http://project.supabase.co',
        })
      )
    ).not.toBeInstanceOf(GiglWorkerTokenError);
    expect(
      capture(() =>
        createGiglTrackingWorkerClient({
          ...configuredEnv,
          NEXT_PUBLIC_SUPABASE_ANON_KEY: '',
        })
      )
    ).not.toBeInstanceOf(GiglWorkerTokenError);
    expect(
      capture(() =>
        createGiglTrackingWorkerClient({
          ...configuredEnv,
          NEXT_PUBLIC_SUPABASE_URL: 'https://attacker.example',
        })
      )
    ).not.toBeInstanceOf(GiglWorkerTokenError);
  });

  it('rejects operations outside the reviewed five-wrapper capability', () => {
    const client = createGiglTrackingWorkerClient(configuredEnv);

    expect(() => client.rpc('unreviewed_operation' as never)).toThrow(
      'Unsupported GIGL tracking database operation'
    );
    expect(rpc).not.toHaveBeenCalled();
  });
});

// Scope-probe-client coverage lives in
// gigl-tracking-worker-scope-probe-client.test.ts (split to keep both
// suites under the 300-line limit).
