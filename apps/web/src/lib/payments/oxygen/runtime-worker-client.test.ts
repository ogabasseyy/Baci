import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.create }));
vi.mock('@/env', () => ({
  getSupabaseUrl: () => 'https://db.example.test',
  getSupabaseAnonKey: () => 'anon-key',
}));

import { createOxygenWorkerClient } from './runtime-worker-client';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-01T00:00:00Z'));
  mocks.create.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
function client(expiresIn: number, error: { message: string } | null = null) {
  const signIn = vi.fn().mockResolvedValue({
    error,
    data: {
      session: { expires_at: Math.floor(Date.now() / 1000) + expiresIn },
    },
  });
  return { auth: { signInWithPassword: signIn } };
}
it('coalesces concurrent sign-ins and reuses the client within one connection', async () => {
  const current = client(300);
  mocks.create.mockReturnValue(current);
  const worker = createOxygenWorkerClient('worker@example.test', 'private');
  expect(await Promise.all([worker(), worker(), worker()])).toEqual([
    current,
    current,
    current,
  ]);
  expect(await worker()).toBe(current);
  expect(mocks.create).toHaveBeenCalledOnce();
  expect(current.auth.signInWithPassword).toHaveBeenCalledExactlyOnceWith({
    email: 'worker@example.test',
    password: 'private',
  });
});
it('creates a fresh authenticated client before session expiry', async () => {
  const first = client(60);
  const second = client(300);
  mocks.create.mockReturnValueOnce(first).mockReturnValueOnce(second);
  const worker = createOxygenWorkerClient('worker@example.test', 'private');
  expect(await worker()).toBe(first);
  vi.advanceTimersByTime(31_000);
  expect(await worker()).toBe(second);
  expect(first.auth.signInWithPassword).toHaveBeenCalledOnce();
  expect(second.auth.signInWithPassword).toHaveBeenCalledOnce();
});
it('does not cache failed or missing-session logins', async () => {
  const first = client(300, { message: 'private error' });
  const second = {
    auth: {
      signInWithPassword: vi
        .fn()
        .mockResolvedValue({ error: null, data: { session: null } }),
    },
  };
  const third = client(300);
  mocks.create
    .mockReturnValueOnce(first)
    .mockReturnValueOnce(second)
    .mockReturnValueOnce(third);
  const worker = createOxygenWorkerClient('worker@example.test', 'private');
  await expect(worker()).rejects.toThrow('Workflow unavailable');
  await expect(worker()).rejects.toThrow('Workflow unavailable');
  expect(await worker()).toBe(third);
  expect(mocks.create).toHaveBeenCalledTimes(3);
});
it('does not share an authenticated client across independent connections', async () => {
  const first = client(300);
  const second = client(300);
  mocks.create.mockReturnValueOnce(first).mockReturnValueOnce(second);
  const one = createOxygenWorkerClient('a@example.test', 'private-a');
  const two = createOxygenWorkerClient('b@example.test', 'private-b');
  expect(await one()).toBe(first);
  expect(await two()).toBe(second);
  expect(mocks.create).toHaveBeenCalledTimes(2);
});

it('coalesces a failed login and retries independently without leaking the error', async () => {
  const first = client(300, { message: 'sensitive backend text' });
  const second = client(300);
  mocks.create.mockReturnValueOnce(first).mockReturnValueOnce(second);
  const worker = createOxygenWorkerClient('worker@example.test', 'private');
  const outcomes = await Promise.allSettled([worker(), worker()]);
  expect(outcomes.every((outcome) => outcome.status === 'rejected')).toBe(true);
  expect(first.auth.signInWithPassword).toHaveBeenCalledOnce();
  expect(JSON.stringify(outcomes)).not.toContain('sensitive backend text');
  expect(await worker()).toBe(second);
  expect(mocks.create).toHaveBeenCalledTimes(2);
});
it('rejects a session expiring inside the safety window', async () => {
  mocks.create.mockReturnValue(client(20));
  const worker = createOxygenWorkerClient('worker@example.test', 'private');
  await expect(worker()).rejects.toThrow('Workflow unavailable');
  await expect(worker()).rejects.toThrow('Workflow unavailable');
  expect(mocks.create).toHaveBeenCalledTimes(2);
});
