import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, expect, it, vi } from 'vitest';
import { gateStartupOnGuestCartCapability } from './guest-cart-startup-gate';

afterEach(() => {
  vi.restoreAllMocks();
});

function setup(rpc: (...args: unknown[]) => unknown) {
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  const onReady = vi.fn();
  const exit = vi.fn(
    (code: number): never => {
      throw new Error(`exit(${code})`);
    }
  );
  const client = { rpc: vi.fn(rpc) } as unknown as Pick<
    SupabaseClient,
    'rpc'
  >;
  return { errorSpy, onReady, exit, client };
}

it('listens once the capability probe passes', async () => {
  const { errorSpy, onReady, exit, client } = setup(async () => ({
    data: null,
    error: null,
  }));
  await gateStartupOnGuestCartCapability({ client, onReady, exit });
  expect(onReady).toHaveBeenCalledTimes(1);
  expect(exit).not.toHaveBeenCalled();
  expect(errorSpy).not.toHaveBeenCalled();
});

it('fails the boot with the token-free probe code', async () => {
  const { errorSpy, onReady, exit, client } = setup(async () => ({
    data: null,
    error: { code: '42501', message: 'permission denied' },
  }));
  await expect(
    gateStartupOnGuestCartCapability({ client, onReady, exit })
  ).rejects.toThrow('exit(1)');
  expect(onReady).not.toHaveBeenCalled();
  expect(exit).toHaveBeenCalledWith(1);
  expect(errorSpy).toHaveBeenCalledWith(
    'FATAL: Guest-cart worker capability probe failed'
  );
  expect(errorSpy).toHaveBeenCalledWith('code=42501');
});

it('fails a hung probe closed after the timeout', async () => {
  const { errorSpy, onReady, exit, client } = setup(
    () => new Promise(() => {})
  );
  await expect(
    gateStartupOnGuestCartCapability({ client, onReady, exit, timeoutMs: 5 })
  ).rejects.toThrow('exit(1)');
  expect(onReady).not.toHaveBeenCalled();
  expect(errorSpy).toHaveBeenCalledWith('code=probe_timeout');
});
