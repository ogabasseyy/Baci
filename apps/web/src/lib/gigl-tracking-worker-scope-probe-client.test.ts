import { createClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createGiglTrackingWorkerScopeProbeClient } from './gigl-tracking-worker-client';

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

describe('createGiglTrackingWorkerScopeProbeClient', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends RPC names unmapped with the same worker authorization', () => {
    const client = createGiglTrackingWorkerScopeProbeClient(configuredEnv);

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

    // The path probe's inner name must reach PostgREST verbatim: the
    // restricted client would remap it to its approved wrapper and
    // the probe could never observe the hook's denial.
    client.rpc('claim_due_gigl_tracking_monitors', {
      p_limit: 0,
      p_worker_id: 'gigl-capability-path-probe',
    });

    expect(rpc).toHaveBeenCalledWith(
      'claim_due_gigl_tracking_monitors',
      { p_limit: 0, p_worker_id: 'gigl-capability-path-probe' },
      undefined
    );
  });

  it('shares the restricted client validation choke point', () => {
    expect(() =>
      createGiglTrackingWorkerScopeProbeClient({
        ...configuredEnv,
        GIGL_TRACKING_WORKER_TOKEN: token('service_role'),
      })
    ).toThrow(
      'GIGL tracking worker token is a usable non-worker JWT; refusing to scope a privileged credential to the poller'
    );
    expect(() =>
      createGiglTrackingWorkerScopeProbeClient({
        ...configuredEnv,
        NEXT_PUBLIC_SUPABASE_URL: 'http://project.supabase.co',
      })
    ).toThrow(
      'GIGL tracking worker Supabase URL must be a credential-free https:// URL'
    );
    expect(createClient).not.toHaveBeenCalled();
  });
});
