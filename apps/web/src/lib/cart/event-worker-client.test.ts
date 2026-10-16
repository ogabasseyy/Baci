import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

it('accepts a token expiring in under five minutes but rejects an expired one', () => {
  const create = vi.fn();
  const nearExpiry = [
    Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url'),
    Buffer.from(
      JSON.stringify({
        role: 'commerce_cart_worker',
        exp: Math.floor(now.getTime() / 1000) + 60,
      })
    ).toString('base64url'),
    'signature',
  ].join('.');
  const env = {
    NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'public',
  };
  createCartEventWorkerClient(
    { ...env, COMMERCE_CART_WORKER_JWT: nearExpiry },
    create,
    now
  );
  expect(create).toHaveBeenCalledTimes(1);

  const expired = [
    Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url'),
    Buffer.from(
      JSON.stringify({
        role: 'commerce_cart_worker',
        exp: Math.floor(now.getTime() / 1000) - 1,
      })
    ).toString('base64url'),
    'signature',
  ].join('.');
  expect(() =>
    createCartEventWorkerClient(
      { ...env, COMMERCE_CART_WORKER_JWT: expired },
      create,
      now
    )
  ).toThrow('Cart event worker authority unavailable');
  expect(create).toHaveBeenCalledTimes(1);
});

it('re-reads a rotated worker token from file on each construction', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cart-worker-'));
  const file = join(dir, 'worker.jwt');
  const first = token('commerce_cart_worker');
  writeFileSync(file, first);
  const env = {
    COMMERCE_CART_WORKER_JWT_FILE: file,
    NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'public',
  };
  const create = vi.fn();
  createCartEventWorkerClient(env, create, now);
  expect(create).toHaveBeenLastCalledWith(
    'https://test.supabase.co',
    'public',
    expect.objectContaining({
      global: { headers: { Authorization: `Bearer ${first}` } },
    })
  );

  const rotated = `${token('commerce_cart_worker')}x`;
  writeFileSync(file, rotated);
  createCartEventWorkerClient(env, create, now);
  expect(create).toHaveBeenLastCalledWith(
    'https://test.supabase.co',
    'public',
    expect.objectContaining({
      global: { headers: { Authorization: `Bearer ${rotated}` } },
    })
  );
});
