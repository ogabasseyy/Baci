import { beforeEach, expect, it, vi } from 'vitest';
import { incrementSupabaseQuotaCounter } from './supabase-quota-counter';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  abortSignal: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock('./scoped-client', () => ({
  createCartQuotaScopedClient: mocks.createClient,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createClient.mockReturnValue({ rpc: mocks.rpc });
  mocks.rpc.mockReturnValue({ abortSignal: mocks.abortSignal });
  mocks.abortSignal.mockResolvedValue({
    data: { count: 1, resetTime: Date.now() + 60_000 },
    error: null,
  });
});

it('requests a counter-scoped client for exactly the quota key and window', async () => {
  const key = 'baci:cart-quota:bootstrap:merchant:hashed-subject';
  const result = await incrementSupabaseQuotaCounter(key, 60_000);
  expect(result).toMatchObject({ count: 1, degraded: false });
  expect(mocks.createClient).toHaveBeenCalledWith(key, 60_000);
  expect(mocks.rpc).toHaveBeenCalledWith('increment_commerce_cart_quota');
  expect(mocks.abortSignal).toHaveBeenCalledWith(expect.any(AbortSignal));
});

it('rejects an RPC failure instead of reporting a healthy shared counter', async () => {
  mocks.abortSignal.mockResolvedValue({
    data: null,
    error: { code: 'PGRST202' },
  });
  await expect(incrementSupabaseQuotaCounter('key', 60_000)).rejects.toThrow();
});

it('propagates an aborted request so quota policy can fail closed', async () => {
  mocks.abortSignal.mockRejectedValue(
    new DOMException('Timed out', 'TimeoutError')
  );
  await expect(
    incrementSupabaseQuotaCounter('key', 60_000)
  ).rejects.toMatchObject({
    reason: 'timeout',
  });
});

it.each([
  -10_000, 70_000,
])('rejects an expiry outside the requested window', async (offset) => {
  mocks.abortSignal.mockResolvedValue({
    data: { count: 1, resetTime: Date.now() + offset },
    error: null,
  });
  await expect(
    incrementSupabaseQuotaCounter('key', 60_000)
  ).rejects.toMatchObject({
    reason: 'invalid_expiry',
  });
});

it.each([
  null,
  { count: 0, resetTime: 1 },
  { count: '1', resetTime: 1 },
  { count: 1 },
  { count: 1, resetTime: -1 },
])('rejects malformed counter results', async (data) => {
  mocks.abortSignal.mockResolvedValue({ data, error: null });
  await expect(incrementSupabaseQuotaCounter('key', 60_000)).rejects.toThrow();
});

it('classifies an invalid counter response without exposing provider details', async () => {
  mocks.abortSignal.mockResolvedValue({
    data: { count: 'bad', resetTime: 1 },
    error: null,
  });
  await expect(
    incrementSupabaseQuotaCounter('secret-key', 60_000)
  ).rejects.toMatchObject({
    reason: 'invalid_response',
    message: 'Cart quota counter unavailable',
  });
});

it('classifies a deadline separately from a provider error', async () => {
  mocks.abortSignal.mockRejectedValue(
    new DOMException('secret provider detail', 'TimeoutError')
  );
  await expect(
    incrementSupabaseQuotaCounter('secret-key', 60_000)
  ).rejects.toMatchObject({
    reason: 'timeout',
    message: 'Cart quota counter unavailable',
  });
});
