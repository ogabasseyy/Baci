// @vitest-environment node
import { inspect } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createWalletPinSalt,
  deriveWalletPinHash,
  deriveWalletPinIdempotencyDigest,
  getWalletPinPepperState,
  readWalletPinPepperState,
  WALLET_PIN_KDF_VERSION,
  type WalletPinPepper,
} from './wallet-pin-kdf';

// Expected values were computed independently with Python's hashlib/hmac:
// scrypt(HMAC-SHA256(pepper, "baci.wallet-pin.v1\0" + pin), salt,
//        N=32768, r=8, p=1, dkLen=32).
const PEPPER = 'baci-wallet-pin-test-pepper-000000000000';
const OTHER_PEPPER = 'baci-wallet-pin-other-pepper-11111111111';
const SALT = '000102030405060708090a0b0c0d0e0f';

function readyPepper(value: string): WalletPinPepper {
  const state = readWalletPinPepperState(value);
  if (state.status !== 'ready') throw new Error('test pepper not ready');
  return state.pepper;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('readWalletPinPepperState', () => {
  it.each([undefined, null, '', '   '])('treats %j as unset', (raw) => {
    expect(readWalletPinPepperState(raw)).toEqual({ status: 'unset' });
  });

  it.each([
    'x'.repeat(31),
    `  ${'x'.repeat(31)}  `,
    'x'.repeat(513),
    42,
  ])('refuses an invalid pepper (case %#)', (raw) => {
    expect(readWalletPinPepperState(raw)).toEqual({ status: 'invalid' });
  });

  it('exposes only a stable public id, derived from the trimmed secret', () => {
    const pepper = readyPepper(PEPPER);
    expect(pepper.id).toBe('d0bc8ce070c22d11');
    expect(readyPepper(`  ${PEPPER}\n`).id).toBe('d0bc8ce070c22d11');
    expect(readyPepper(OTHER_PEPPER).id).toBe('fa2b4b51bb36dd21');
  });

  it('never serialises or prints the secret', () => {
    const pepper = readyPepper(PEPPER);
    expect(JSON.stringify(pepper)).toBe('{"id":"d0bc8ce070c22d11"}');
    expect(inspect(pepper, { showHidden: true, depth: 5 })).not.toContain(
      'test-pepper'
    );
    expect(Object.isFrozen(pepper)).toBe(true);
  });

  it('reads WALLET_PIN_PEPPER from the server environment', () => {
    vi.stubEnv('WALLET_PIN_PEPPER', '');
    expect(getWalletPinPepperState()).toEqual({ status: 'unset' });
    vi.stubEnv('WALLET_PIN_PEPPER', 'too-short');
    expect(getWalletPinPepperState()).toEqual({ status: 'invalid' });
    vi.stubEnv('WALLET_PIN_PEPPER', PEPPER);
    const state = getWalletPinPepperState();
    expect(state.status === 'ready' && state.pepper.id).toBe(
      'd0bc8ce070c22d11'
    );
  });
});

describe('deriveWalletPinHash', () => {
  it('uses KDF version 1', () => {
    expect(WALLET_PIN_KDF_VERSION).toBe(1);
  });

  it.each([
    [
      '2580',
      '4582efeab2c2c9c37c747389ab8d1a8c9e5f3968b71f77ee49c866c0564b4e3a',
    ],
    [
      '0000',
      '822eb24bd3a5e7ae1db774c222b9ec82ce8bbd9f8e9ee663d43d6b81bcc1d789',
    ],
    [
      '135790',
      '6573367178c4814da7dd9e2e5172b3b074c3c088ec923e7743a09b38d5aa33b5',
    ],
  ])('matches the independent vector for PIN %s', async (pin, expected) => {
    await expect(
      deriveWalletPinHash({ pin, salt: SALT, pepper: readyPepper(PEPPER) })
    ).resolves.toBe(expected);
  });

  it('changes with the salt and with the pepper', async () => {
    await expect(
      deriveWalletPinHash({
        pin: '2580',
        salt: 'ff'.repeat(16),
        pepper: readyPepper(PEPPER),
      })
    ).resolves.toBe(
      'f166b6faed1b432c746dacb6cb007b6dd2c8e70032ab882369579b5f6a8da830'
    );
    await expect(
      deriveWalletPinHash({
        pin: '2580',
        salt: SALT,
        pepper: readyPepper(OTHER_PEPPER),
      })
    ).resolves.toBe(
      '9a67158bb652bb5fc8c4cb01db02d0ab50a3a35140f5752cece5a64bf2c76cbf'
    );
  });

  it.each([
    '123',
    '1234567',
    '12a4',
    ' 1234',
    '1234\n',
    '١٢٣٤',
  ])('refuses a malformed PIN without echoing it (case %#)', async (pin) => {
    const error = await deriveWalletPinHash({
      pin,
      salt: SALT,
      pepper: readyPepper(PEPPER),
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('Invalid wallet PIN format');
  });

  it.each([
    SALT.toUpperCase(),
    SALT.slice(2),
    `${SALT}00`,
    'zz'.repeat(16),
  ])('refuses a malformed salt (case %#)', async (salt) => {
    await expect(
      deriveWalletPinHash({ pin: '2580', salt, pepper: readyPepper(PEPPER) })
    ).rejects.toThrow('Invalid wallet PIN salt');
  });

  it('refuses a pepper object it did not create', async () => {
    const forged = Object.freeze({
      id: 'd0bc8ce070c22d11',
    }) as unknown as WalletPinPepper;
    await expect(
      deriveWalletPinHash({ pin: '2580', salt: SALT, pepper: forged })
    ).rejects.toThrow('Wallet PIN pepper unavailable');
  });
});

describe('createWalletPinSalt', () => {
  it('hex-encodes 16 bytes from the random source', () => {
    const source = vi.fn((size: number) =>
      Buffer.from(Array.from({ length: size }, (_, index) => index))
    );
    expect(createWalletPinSalt(source)).toBe(SALT);
    expect(source).toHaveBeenCalledWith(16);
  });

  it('refuses a random source that returns the wrong length', () => {
    expect(() => createWalletPinSalt(() => Buffer.alloc(15))).toThrow(
      'Wallet PIN salt unavailable'
    );
  });
});

describe('deriveWalletPinIdempotencyDigest', () => {
  it('returns the SHA-256 of the exact Idempotency-Key', () => {
    expect(deriveWalletPinIdempotencyDigest('order-0001')).toBe(
      'dc8fac035907b40165432a3b32d82df9f20d51706b0850a3290605d8a26e7e8e'
    );
  });

  it.each([
    '',
    'has space',
    'tab\tkey',
    'k'.repeat(256),
    'café',
  ])('refuses an unusable key (case %#)', (key) => {
    expect(() => deriveWalletPinIdempotencyDigest(key)).toThrow(
      'Invalid Idempotency-Key'
    );
  });
});
