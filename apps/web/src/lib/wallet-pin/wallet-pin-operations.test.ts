// @vitest-environment node
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { signWalletPinAttestation } from './wallet-pin-attestation';
import {
  deriveWalletPinHash,
  getWalletPinPepperState,
  WALLET_PIN_KDF_VERSION,
} from './wallet-pin-kdf';
import {
  changeWalletPin,
  readWalletPinStatus,
  resetWalletPin,
  setWalletPin,
} from './wallet-pin-operations';

vi.mock('server-only', () => ({}));

const secret = createHash('sha256').update('s5s-ops-pepper').digest('hex');
const oldSalt = createHash('sha256')
  .update('s5s-ops-old-salt')
  .digest('hex')
  .slice(0, 32);
const userId = 'f1a00000-0000-4000-8000-000000000001';
const merchantId = 'f1a00002-0000-4000-8000-000000000001';
const nowMs = 1_793_600_000_000;
const setState = {
  status: 'set',
  kdfVersion: 1,
  salt: oldSalt,
  attemptsRemaining: 5,
};

function pepper() {
  const state = getWalletPinPepperState();
  if (state.status !== 'ready') throw new Error('pepper missing in test');
  return state.pepper;
}
function rpcOf(answers: Record<string, unknown>) {
  return vi.fn((name: string, _args?: Record<string, unknown>) =>
    Promise.resolve({ data: answers[name] ?? null, error: null })
  );
}
type Rpc = Parameters<typeof setWalletPin>[0]['rpc'];
const asRpc = (fn: ReturnType<typeof vi.fn>) => fn as unknown as Rpc;
const base = (fn: ReturnType<typeof vi.fn>) => ({
  rpc: asRpc(fn),
  userId,
  merchantId,
  now: () => nowMs,
});

beforeEach(() => vi.stubEnv('WALLET_PIN_PEPPER', secret));
afterEach(() => vi.unstubAllEnvs());

it('reports unavailable without a database call when the pepper is unusable', async () => {
  const rpc = rpcOf({});
  for (const value of ['', 'short']) {
    vi.stubEnv('WALLET_PIN_PEPPER', value);
    expect(await readWalletPinStatus({ rpc: asRpc(rpc), merchantId })).toEqual({
      hasPin: false,
      resetRequired: false,
      available: false,
      signInConfirmationRequired: false,
    });
    expect(await setWalletPin({ ...base(rpc), pin: '482915' })).toEqual({
      status: 'unavailable',
    });
  }
  expect(rpc).not.toHaveBeenCalled();
});

it('throws on a database error or an unexpected answer instead of passing', async () => {
  const failing = vi.fn(() =>
    Promise.resolve({ data: null, error: { message: 'boom 482915' } })
  );
  await expect(
    setWalletPin({ ...base(failing), pin: '482915' })
  ).rejects.toThrow('Wallet PIN set_wallet_pin unavailable');
  const odd = rpcOf({ set_wallet_pin: { status: 'changed' } });
  await expect(setWalletPin({ ...base(odd), pin: '482915' })).rejects.toThrow();
  const stateless = rpcOf({ get_wallet_pin_state: { status: 'weird' } });
  await expect(
    readWalletPinStatus({ rpc: asRpc(stateless), merchantId })
  ).rejects.toThrow();
});

it('sets a PIN with a fresh salt, a server-derived hash and a matching attestation', async () => {
  const rpc = rpcOf({ set_wallet_pin: { status: 'set' } });
  expect(await setWalletPin({ ...base(rpc), pin: '482915' })).toEqual({
    status: 'ok',
  });
  const args = rpc.mock.calls[0]?.[1] as unknown as Record<string, string>;
  expect(rpc.mock.calls[0]?.[0]).toBe('set_wallet_pin');
  const hash = await deriveWalletPinHash({
    pin: '482915',
    salt: args.p_salt,
    pepper: pepper(),
  });
  expect(args).toEqual({
    p_merchant_id: merchantId,
    p_pepper_id: pepper().id,
    p_kdf_version: WALLET_PIN_KDF_VERSION,
    p_salt: args.p_salt,
    p_pin_hash: hash,
    p_attestation: signWalletPinAttestation({
      pepper: pepper(),
      userId,
      merchantId,
      attestedAtMs: nowMs,
      request: { operation: 'set', salt: args.p_salt, pinHash: hash },
    }),
  });
  expect(args.p_salt).toMatch(/^[0-9a-f]{32}$/);
  expect(JSON.stringify(args)).not.toContain('482915');
});

it('maps set refusals', async () => {
  for (const status of [
    'already_set',
    'reauthentication_required',
    'unavailable',
  ] as const) {
    const rpc = rpcOf({ set_wallet_pin: { status } });
    expect(await setWalletPin({ ...base(rpc), pin: '482915' })).toEqual({
      status,
    });
  }
});

it('changes a PIN using the stored salt for the current hash and a new salt for the new one', async () => {
  const rpc = rpcOf({
    get_wallet_pin_state: setState,
    change_wallet_pin: { status: 'changed' },
  });
  expect(
    await changeWalletPin({
      ...base(rpc),
      currentPin: '482915',
      newPin: '730184',
    })
  ).toEqual({ status: 'ok' });
  const [name, args] = rpc.mock.calls[1] as unknown as [
    string,
    Record<string, string>,
  ];
  expect(name).toBe('change_wallet_pin');
  const currentHash = await deriveWalletPinHash({
    pin: '482915',
    salt: oldSalt,
    pepper: pepper(),
  });
  const newHash = await deriveWalletPinHash({
    pin: '730184',
    salt: args.p_salt,
    pepper: pepper(),
  });
  expect(args.p_salt).not.toBe(oldSalt);
  expect(args).toEqual({
    p_merchant_id: merchantId,
    p_pepper_id: pepper().id,
    p_current_pin_hash: currentHash,
    p_kdf_version: WALLET_PIN_KDF_VERSION,
    p_salt: args.p_salt,
    p_pin_hash: newHash,
    p_attestation: signWalletPinAttestation({
      pepper: pepper(),
      userId,
      merchantId,
      attestedAtMs: nowMs,
      request: {
        operation: 'change',
        currentPinHash: currentHash,
        salt: args.p_salt,
        pinHash: newHash,
      },
    }),
  });
  expect(JSON.stringify(args)).not.toMatch(/482915|730184/);
});

it('stops a change at a state that cannot be changed, with no second call', async () => {
  for (const state of [
    { status: 'not_set' },
    { status: 'reset_required' },
    { status: 'unavailable' },
    { status: 'locked', lockedUntil: '2026-11-03T12:00:00Z' },
  ]) {
    const rpc = rpcOf({ get_wallet_pin_state: state });
    const out = await changeWalletPin({
      ...base(rpc),
      currentPin: '482915',
      newPin: '730184',
    });
    expect(out).toEqual(state);
    expect(rpc).toHaveBeenCalledTimes(1);
  }
});

it('maps a wrong current PIN and a lockout from change', async () => {
  const wrong = rpcOf({
    get_wallet_pin_state: setState,
    change_wallet_pin: { status: 'incorrect', attemptsRemaining: 3 },
  });
  expect(
    await changeWalletPin({
      ...base(wrong),
      currentPin: '111111',
      newPin: '730184',
    })
  ).toEqual({ status: 'incorrect', attemptsRemaining: 3 });
  const locked = rpcOf({
    get_wallet_pin_state: setState,
    change_wallet_pin: {
      status: 'locked',
      lockedUntil: '2026-11-03T12:30:00Z',
    },
  });
  expect(
    await changeWalletPin({
      ...base(locked),
      currentPin: '111111',
      newPin: '730184',
    })
  ).toEqual({ status: 'locked', lockedUntil: '2026-11-03T12:30:00Z' });
});

it('resets with a fresh salt and an attestation for the reset operation', async () => {
  const rpc = rpcOf({ reset_wallet_pin: { status: 'reset' } });
  expect(await resetWalletPin({ ...base(rpc), pin: '482915' })).toEqual({
    status: 'ok',
  });
  const [name, args] = rpc.mock.calls[0] as unknown as [
    string,
    Record<string, string>,
  ];
  expect(name).toBe('reset_wallet_pin');
  const hash = await deriveWalletPinHash({
    pin: '482915',
    salt: args.p_salt,
    pepper: pepper(),
  });
  expect(args.p_pin_hash).toBe(hash);
  expect(args.p_attestation).toBe(
    signWalletPinAttestation({
      pepper: pepper(),
      userId,
      merchantId,
      attestedAtMs: nowMs,
      request: { operation: 'reset', salt: args.p_salt, pinHash: hash },
    })
  );
});

it('maps reset refusals, including a stale sign-in', async () => {
  for (const status of [
    'not_set',
    'unavailable',
    'reauthentication_required',
  ] as const) {
    const rpc = rpcOf({ reset_wallet_pin: { status } });
    expect(await resetWalletPin({ ...base(rpc), pin: '482915' })).toEqual({
      status,
    });
  }
});
