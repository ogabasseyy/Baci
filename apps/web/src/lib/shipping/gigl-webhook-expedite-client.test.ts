import { createClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createGiglWebhookExpediteClient } from './gigl-webhook-expedite-client';

vi.mock('server-only', () => ({}));

const rpc = vi.fn();
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ rpc })),
}));

function token(role: string, exp = 4_102_444_800) {
  const header = Buffer.from(
    JSON.stringify({ alg: 'ES256', typ: 'JWT' })
  ).toString('base64url');
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

describe('createGiglWebhookExpediteClient', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls only the expedite wrapper with the worker JWT', async () => {
    rpc.mockResolvedValue({ data: { matched: 1, expedited: 1 }, error: null });
    const client = createGiglWebhookExpediteClient(configuredEnv);

    await expect(client.expedite('1349639673', 'MCRT')).resolves.toEqual({
      data: { matched: 1, expedited: 1 },
      error: null,
    });
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
    expect(rpc).toHaveBeenCalledWith(
      'gigl_worker_expedite_tracking_monitor',
      {
        p_status_code: 'MCRT',
        p_tracking_number: '1349639673',
      },
      undefined
    );
  });

  it('exposes no other worker operation', () => {
    const client = createGiglWebhookExpediteClient(configuredEnv);

    expect(Object.keys(client)).toEqual(['expedite']);
  });

  it('refuses a missing or expired worker token', () => {
    expect(() =>
      createGiglWebhookExpediteClient({
        ...configuredEnv,
        GIGL_TRACKING_WORKER_TOKEN: undefined,
      })
    ).toThrow('GIGL tracking worker database capability is invalid');
    expect(() =>
      createGiglWebhookExpediteClient({
        ...configuredEnv,
        GIGL_TRACKING_WORKER_TOKEN: token('gigl_tracking_worker', 1),
      })
    ).toThrow('GIGL tracking worker database capability is invalid');
    expect(createClient).not.toHaveBeenCalled();
  });

  it('refuses a service-role JWT in the worker slot', () => {
    expect(() =>
      createGiglWebhookExpediteClient({
        ...configuredEnv,
        GIGL_TRACKING_WORKER_TOKEN: token('service_role'),
      })
    ).toThrow('usable non-worker JWT');
    expect(createClient).not.toHaveBeenCalled();
  });

  it('keeps the production Supabase host pin', () => {
    expect(() =>
      createGiglWebhookExpediteClient({
        ...configuredEnv,
        NEXT_PUBLIC_SUPABASE_URL: 'https://attacker.example',
      })
    ).toThrow(
      'GIGL tracking worker Supabase URL host is not an allowed origin'
    );
  });
});
