// @vitest-environment node
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getWalletPinPepperState } from './wallet-pin-kdf';
import { readWalletPinStatus } from './wallet-pin-operations';

vi.mock('server-only', () => ({}));

const secret = createHash('sha256').update('s5s-sign-in-pepper').digest('hex');
const merchantId = 'f1a00002-0000-4000-8000-000000000001';
const setState = {
  status: 'set',
  kdfVersion: 1,
  salt: 'ab'.repeat(16),
  attemptsRemaining: 5,
};

type Answer = { data: unknown; error: unknown };
function rpcOf(state: unknown, recent: Answer | (() => never)) {
  return vi.fn((name: string) => {
    if (name === 'get_wallet_pin_state')
      return Promise.resolve({ data: state, error: null });
    if (typeof recent === 'function') return recent();
    return Promise.resolve(recent);
  });
}
type Rpc = Parameters<typeof readWalletPinStatus>[0]['rpc'];
const read = (rpc: ReturnType<typeof rpcOf>) =>
  readWalletPinStatus({ rpc: rpc as unknown as Rpc, merchantId });

function pepperId() {
  const state = getWalletPinPepperState();
  if (state.status !== 'ready') throw new Error('pepper missing in test');
  return state.pepper.id;
}

beforeEach(() => vi.stubEnv('WALLET_PIN_PEPPER', secret));
afterEach(() => vi.unstubAllEnvs());

describe('bugfix: a stale sign-in is only discovered after typing a new PIN twice', () => {
  it('says a sign-in confirmation is needed before setting a first PIN when the sign-in is old', async () => {
    const rpc = rpcOf({ status: 'not_set' }, { data: false, error: null });
    expect(await read(rpc)).toEqual({
      hasPin: false,
      resetRequired: false,
      available: true,
      signInConfirmationRequired: true,
    });
    expect(rpc).toHaveBeenCalledWith('has_recent_wallet_pin_sign_in', {});
  });

  it('says so for a required reset and for a set PIN (forgot PIN resets)', async () => {
    for (const state of [{ status: 'reset_required' }, setState]) {
      const status = await read(rpcOf(state, { data: false, error: null }));
      expect(status.signInConfirmationRequired).toBe(true);
    }
  });

  it('needs no confirmation after a recent sign-in', async () => {
    const status = await read(
      rpcOf({ status: 'not_set' }, { data: true, error: null })
    );
    expect(status.signInConfirmationRequired).toBe(false);
  });
});

it('never asks for a confirmation when the PIN service is unavailable', async () => {
  const rpc = rpcOf({ status: 'unavailable' }, { data: false, error: null });
  expect((await read(rpc)).signInConfirmationRequired).toBe(false);
  expect(rpc).not.toHaveBeenCalledWith('has_recent_wallet_pin_sign_in', {});
});

it('falls back to the old behaviour (no up-front step) when the read fails', async () => {
  const failures: Array<Answer | (() => never)> = [
    { data: null, error: { message: 'function does not exist' } },
    { data: 'yes', error: null },
    () => {
      throw new Error('network');
    },
  ];
  for (const recent of failures) {
    const status = await read(rpcOf({ status: 'not_set' }, recent));
    expect(status).toEqual({
      hasPin: false,
      resetRequired: false,
      available: true,
      signInConfirmationRequired: false,
    });
  }
});

it('reports status from the database state', async () => {
  const cases = [
    [
      setState,
      {
        hasPin: true,
        resetRequired: false,
        available: true,
        signInConfirmationRequired: false,
      },
    ],
    [
      { status: 'locked', lockedUntil: '2026-11-03T12:00:00Z' },
      {
        hasPin: true,
        resetRequired: false,
        available: true,
        signInConfirmationRequired: false,
      },
    ],
    [
      { status: 'reset_required' },
      {
        hasPin: true,
        resetRequired: true,
        available: true,
        signInConfirmationRequired: false,
      },
    ],
    [
      { status: 'not_set' },
      {
        hasPin: false,
        resetRequired: false,
        available: true,
        signInConfirmationRequired: false,
      },
    ],
    [
      { status: 'unavailable' },
      {
        hasPin: false,
        resetRequired: false,
        available: false,
        signInConfirmationRequired: false,
      },
    ],
  ] as const;
  for (const [state, expected] of cases) {
    const rpc = rpcOf(state, { data: true, error: null });
    expect(await read(rpc)).toEqual(expected);
    expect(rpc).toHaveBeenCalledWith('get_wallet_pin_state', {
      p_merchant_id: merchantId,
      p_pepper_id: pepperId(),
    });
  }
});
