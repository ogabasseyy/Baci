import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createClient, rpc } = vi.hoisted(() => ({
  createClient: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock('@supabase/supabase-js', () => ({ createClient }));

import { createImmediateNotificationRedriveClient } from './notification-redrive-client';

function token(role: string) {
  return `${Buffer.from(JSON.stringify({ alg: 'ES256' })).toString('base64url')}.${Buffer.from(JSON.stringify({ role, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.signature`;
}

const env = {
  NODE_ENV: 'production',
  NEXT_PUBLIC_SUPABASE_URL: 'https://aivqthbxdshhltbwipbr.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'public-key',
  IMMEDIATE_NOTIFICATION_REDRIVE_WORKER_TOKEN: token(
    'immediate_notification_redrive'
  ),
};

describe('immediate notification redrive capability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createClient.mockReturnValue({ rpc });
  });

  it('sends only the restricted worker credential to the pinned origin', () => {
    createImmediateNotificationRedriveClient(env);
    expect(createClient).toHaveBeenCalledWith(
      new URL(env.NEXT_PUBLIC_SUPABASE_URL).toString(),
      env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      expect.objectContaining({
        global: {
          headers: {
            Authorization: `Bearer ${env.IMMEDIATE_NOTIFICATION_REDRIVE_WORKER_TOKEN}`,
          },
        },
      })
    );
  });

  it('rejects service-role credentials and foreign origins before constructing a client', () => {
    expect(() =>
      createImmediateNotificationRedriveClient({
        ...env,
        IMMEDIATE_NOTIFICATION_REDRIVE_WORKER_TOKEN: token('service_role'),
      })
    ).toThrow();
    expect(() =>
      createImmediateNotificationRedriveClient({
        ...env,
        NEXT_PUBLIC_SUPABASE_URL: 'https://attacker.example',
      })
    ).toThrow();
    expect(createClient).not.toHaveBeenCalled();
  });

  it('rejects RPCs outside the fixed recovery boundary', () => {
    const client = createImmediateNotificationRedriveClient(env);
    expect(() => client.rpc('arbitrary_rpc', {})).toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('allows only the named dispatch operation through the capability', () => {
    const client = createImmediateNotificationRedriveClient(env);
    const args = { p_order_id: 'order', p_claim_token: 'lease' };
    client.rpc('begin_immediate_notification_dispatch', args);
    expect(rpc).toHaveBeenCalledWith(
      'begin_immediate_notification_dispatch',
      args
    );
  });
});
