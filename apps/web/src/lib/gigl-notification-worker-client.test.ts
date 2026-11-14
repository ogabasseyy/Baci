import { createClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createGiglNotificationWorkerClient,
  GIGL_NOTIFICATION_RPC_NAMES,
} from './gigl-notification-worker-client';
import { GiglWorkerTokenError } from './gigl-tracking-worker-client';

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

describe('createGiglNotificationWorkerClient', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls an allowlisted notification wrapper with the worker JWT', async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    const client = createGiglNotificationWorkerClient(configuredEnv);

    await client.rpc('gigl_worker_claim_notifications', {
      p_limit: 3,
      p_worker_id: 'w',
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
      'gigl_worker_claim_notifications',
      { p_limit: 3, p_worker_id: 'w' },
      undefined
    );
  });

  it('allowlists exactly the twelve notification wrappers', () => {
    expect([...GIGL_NOTIFICATION_RPC_NAMES].sort()).toEqual(
      [
        'gigl_worker_begin_notification_dispatch',
        'gigl_worker_claim_activation_reminder',
        'gigl_worker_claim_notifications',
        'gigl_worker_complete_notification',
        'gigl_worker_deactivate_notification_push_tokens',
        'gigl_worker_notification_activation_candidates',
        'gigl_worker_notification_customer',
        'gigl_worker_notification_event',
        'gigl_worker_notification_push_tokens',
        'gigl_worker_record_notification_push_attempt',
        'gigl_worker_release_activation_reminders',
        'gigl_worker_store_notification_push_tickets',
      ].sort()
    );
  });

  it.each([
    'claim_shipment_tracking_notifications',
    'complete_shipment_tracking_notification',
    'gigl_worker_apply_tracking_result',
    'push_tokens',
  ])('refuses the non-notification operation %s', (name) => {
    const client = createGiglNotificationWorkerClient(configuredEnv);

    expect(() => client.rpc(name as never, {})).toThrow(
      'Unsupported GIGL notification database operation'
    );
    expect(rpc).not.toHaveBeenCalled();
  });

  it('fails closed without a usable worker token', () => {
    expect(() =>
      createGiglNotificationWorkerClient({
        ...configuredEnv,
        GIGL_TRACKING_WORKER_TOKEN: undefined,
      })
    ).toThrow(GiglWorkerTokenError);
  });

  it('refuses a service-role JWT instead of sending it', () => {
    expect(() =>
      createGiglNotificationWorkerClient({
        ...configuredEnv,
        GIGL_TRACKING_WORKER_TOKEN: token('service_role'),
      })
    ).toThrow();
    expect(createClient).not.toHaveBeenCalled();
  });
});
