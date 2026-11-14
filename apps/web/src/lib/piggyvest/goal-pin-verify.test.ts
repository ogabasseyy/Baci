// @vitest-environment node
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { buildGoalPinBinding } from './goal-pin-binding';
import { verifyGoalPin } from './goal-pin-verify';

vi.mock('server-only', () => ({}));
const pepper = createHash('sha256').update('s5-verify-pepper').digest('hex');
const salt = createHash('sha256')
  .update('s5-verify-salt')
  .digest('hex')
  .slice(0, 32);
const proof = createHash('sha256').update('s5-verify-proof').digest('hex');
const userId = 'f1a00000-0000-4000-8000-000000000001';
const merchantId = 'f1a00002-0000-4000-8000-000000000001';
const goalId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const operationId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const binding = buildGoalPinBinding({
  action: 'cancel',
  goalId,
  operationId,
});
const pin = '482915';
const setState = { status: 'set', kdfVersion: 1, salt, attemptsRemaining: 5 };

function run(rpc: ReturnType<typeof vi.fn>) {
  return verifyGoalPin({
    rpc: rpc as unknown as Parameters<typeof verifyGoalPin>[0]['rpc'],
    userId,
    merchantId,
    pin,
    binding,
    now: () => 1_793_600_000_000,
  });
}
beforeEach(() => vi.stubEnv('WALLET_PIN_PEPPER', pepper));
afterEach(() => vi.unstubAllEnvs());

it('is unavailable, without any database call, when the server pepper is unset', async () => {
  vi.stubEnv('WALLET_PIN_PEPPER', '');
  const rpc = vi.fn();
  expect(await run(rpc)).toEqual({ status: 'unavailable' });
  expect(rpc).not.toHaveBeenCalled();
});
it.each([
  'not_set',
  'reset_required',
  'unavailable',
] as const)('stops at the %s PIN state without attempting a check', async (status) => {
  const rpc = vi.fn().mockResolvedValue({ data: { status }, error: null });
  expect(await run(rpc)).toEqual({ status });
  expect(rpc).toHaveBeenCalledTimes(1);
});
it('reports a locked PIN without attempting a check', async () => {
  const rpc = vi.fn().mockResolvedValue({
    data: { status: 'locked', lockedUntil: '2026-11-03T12:00:00Z' },
    error: null,
  });
  expect(await run(rpc)).toEqual({
    status: 'locked',
    lockedUntil: '2026-11-03T12:00:00Z',
  });
  expect(rpc).toHaveBeenCalledTimes(1);
});
it('sends a hashed, attested, binding-scoped check and returns the proof', async () => {
  const rpc = vi
    .fn()
    .mockResolvedValueOnce({ data: setState, error: null })
    .mockResolvedValueOnce({
      data: { status: 'verified', proof, expiresAt: '2026-11-03T12:02:00Z' },
      error: null,
    });
  expect(await run(rpc)).toEqual({
    status: 'verified',
    proof,
    expiresAt: '2026-11-03T12:02:00Z',
  });
  const [name, args] = rpc.mock.calls[1];
  expect(name).toBe('verify_wallet_pin');
  expect(args).toMatchObject({
    p_merchant_id: merchantId,
    p_purpose: 'goal_cancel',
    p_amount_kobo: 1,
    p_idempotency_key_sha256: binding.idempotencyKeySha256,
  });
  expect(args.p_pin_hash).toMatch(/^[0-9a-f]{64}$/);
  expect(args.p_attestation).toMatch(/^1793600000000\.[0-9a-f]{64}$/);
  expect(JSON.stringify(rpc.mock.calls)).not.toContain(pin);
});
it('passes a wrong PIN through with the attempts left', async () => {
  const rpc = vi
    .fn()
    .mockResolvedValueOnce({ data: setState, error: null })
    .mockResolvedValueOnce({
      data: { status: 'incorrect', attemptsRemaining: 2 },
      error: null,
    });
  expect(await run(rpc)).toEqual({ status: 'incorrect', attemptsRemaining: 2 });
});
it('passes the lockout reached by the failed attempt through', async () => {
  const rpc = vi
    .fn()
    .mockResolvedValueOnce({ data: setState, error: null })
    .mockResolvedValueOnce({
      data: { status: 'locked', lockedUntil: '2026-11-03T12:30:00Z' },
      error: null,
    });
  expect(await run(rpc)).toMatchObject({ status: 'locked' });
});
it('throws, without echoing the PIN, on a database error', async () => {
  const rpc = vi
    .fn()
    .mockResolvedValue({ data: null, error: { message: `bad ${pin}` } });
  const error = await run(rpc).catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).not.toContain(pin);
});
it.each([
  { status: 'verified' },
  { status: 'verified', proof: 'short', expiresAt: 'x' },
  { status: 'mystery' },
  null,
])('throws on a malformed check answer %j rather than passing', async (data) => {
  const rpc = vi
    .fn()
    .mockResolvedValueOnce({ data: setState, error: null })
    .mockResolvedValueOnce({ data, error: null });
  await expect(run(rpc)).rejects.toThrow();
});
it('throws on a malformed state answer rather than guessing a salt', async () => {
  const rpc = vi
    .fn()
    .mockResolvedValue({ data: { status: 'set' }, error: null });
  await expect(run(rpc)).rejects.toThrow();
  expect(rpc).toHaveBeenCalledTimes(1);
});
