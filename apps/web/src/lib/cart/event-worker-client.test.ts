import { expect, it, vi } from 'vitest';
import { createCartEventWorkerClient } from './event-worker-client';

const now = new Date('2026-10-14T10:00:00Z');
const token = (role: string) =>
  [
    Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url'),
    Buffer.from(
      JSON.stringify({ role, exp: Math.floor(now.getTime() / 1000) + 3600 })
    ).toString('base64url'),
    'signature',
  ].join('.');
it.each([
  'service_role',
  'authenticated',
  'commerce_cart_receiver',
])('rejects %s before constructing a client', (role) => {
  const create = vi.fn();
  expect(() =>
    createCartEventWorkerClient(
      {
        COMMERCE_CART_WORKER_JWT: token(role),
        NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
        NEXT_PUBLIC_SUPABASE_ANON_KEY: 'public',
      },
      create,
      now
    )
  ).toThrow('Cart event worker authority unavailable');
  expect(create).not.toHaveBeenCalled();
});
it('uses only the scoped cart worker token, with no persisted shopper auth', () => {
  const create = vi.fn();
  const jwt = token('commerce_cart_worker');
  createCartEventWorkerClient(
    {
      COMMERCE_CART_WORKER_JWT: jwt,
      NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'public',
    },
    create,
    now
  );
  expect(create).toHaveBeenCalledWith('https://test.supabase.co', 'public', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
});
