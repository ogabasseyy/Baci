// @vitest-environment node
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { signWalletPinAttestation } from './wallet-pin-attestation';
import {
  deriveWalletPinAttestationKey,
  readWalletPinPepperState,
  type WalletPinPepper,
} from './wallet-pin-kdf';

// The pepper string and hex values are the vectors of wallet-pin-kdf.test.ts
// and supabase/tests/wallet_pin_store_*.sql. The expected attestations were
// computed independently with Python's hmac/hashlib, and the SQL suite checks
// the same verify vector with pgcrypto. The derived key is only ever read from
// the module under test; no HMAC key is written out in this file.
const PEPPER = 'baci-wallet-pin-test-pepper-000000000000';
const USER_ID = 'f1a00000-0000-4000-8000-000000000001';
const MERCHANT_ID = 'f1a00002-0000-4000-8000-000000000001';
const SALT = '000102030405060708090a0b0c0d0e0f';
const PIN_2580 =
  '4582efeab2c2c9c37c747389ab8d1a8c9e5f3968b71f77ee49c866c0564b4e3a';
const PIN_0000 =
  '822eb24bd3a5e7ae1db774c222b9ec82ce8bbd9f8e9ee663d43d6b81bcc1d789';
const IDEM_1 =
  'dc8fac035907b40165432a3b32d82df9f20d51706b0850a3290605d8a26e7e8e';
const ATTESTATION_KEY =
  '96ade7e97155b7d8d2f2a672d23489bdddfefff892691beeae2f2b9ea3502ce9';
const AT_MS = 1_793_600_000_000;

function readyPepper(value: string): WalletPinPepper {
  const state = readWalletPinPepperState(value);
  if (state.status !== 'ready') throw new Error('test pepper not ready');
  return state.pepper;
}

const base = {
  pepper: readyPepper(PEPPER),
  userId: USER_ID,
  merchantId: MERCHANT_ID,
  attestedAtMs: AT_MS,
};

describe('deriveWalletPinAttestationKey', () => {
  it('matches the independently computed key and differs per pepper', () => {
    expect(deriveWalletPinAttestationKey(base.pepper).toString('hex')).toBe(
      ATTESTATION_KEY
    );
    expect(
      deriveWalletPinAttestationKey(
        readyPepper('baci-wallet-pin-other-pepper-11111111111')
      ).toString('hex')
    ).not.toBe(ATTESTATION_KEY);
  });

  it('refuses a pepper handle this module did not create', () => {
    const forged = Object.freeze({ id: 'd0bc8ce070c22d11' }) as WalletPinPepper;
    expect(() => deriveWalletPinAttestationKey(forged)).toThrow(
      'Wallet PIN pepper unavailable'
    );
  });
});

describe('signWalletPinAttestation', () => {
  it('matches the independently computed verify and set vectors', () => {
    expect(
      signWalletPinAttestation({
        ...base,
        request: {
          operation: 'verify',
          pinHash: PIN_2580,
          purpose: 'vtu',
          amountKobo: 5000,
          idempotencyKeySha256: IDEM_1,
        },
      })
    ).toBe(
      '1793600000000.c084dfadf428afad472ba1983d80ed8bff5827bf75027bd17644694eb79f1404'
    );
    expect(
      signWalletPinAttestation({
        ...base,
        request: { operation: 'set', salt: SALT, pinHash: PIN_2580 },
      })
    ).toBe(
      '1793600000000.76e301753c9e5b2b1ce0894eab62dfa363943618854a8b9101e600d5b25ee832'
    );
  });

  it('signs change with the current hash first, under the derived key', () => {
    const message = [
      'baci.wallet-pin.attestation.v1',
      'change',
      USER_ID,
      MERCHANT_ID,
      'd0bc8ce070c22d11',
      String(AT_MS),
      PIN_2580,
      '1',
      SALT,
      PIN_0000,
    ].join('\n');
    expect(
      signWalletPinAttestation({
        ...base,
        request: {
          operation: 'change',
          currentPinHash: PIN_2580,
          salt: SALT,
          pinHash: PIN_0000,
        },
      })
    ).toBe(
      `${AT_MS}.${createHmac(
        'sha256',
        deriveWalletPinAttestationKey(base.pepper)
      )
        .update(message)
        .digest('hex')}`
    );
  });

  it('binds the operation: set and reset of the same PIN differ', () => {
    const request = { salt: SALT, pinHash: PIN_2580 } as const;
    expect(
      signWalletPinAttestation({
        ...base,
        request: { operation: 'set', ...request },
      })
    ).not.toBe(
      signWalletPinAttestation({
        ...base,
        request: { operation: 'reset', ...request },
      })
    );
  });

  it.each([
    { userId: 'F1A00000-0000-4000-8000-000000000001' },
    { merchantId: 'not-a-uuid' },
    { attestedAtMs: 1.5 },
    { attestedAtMs: 99_999_999_999 },
  ])('refuses a malformed binding without echoing it (case %#)', (override) => {
    const call = () =>
      signWalletPinAttestation({
        ...base,
        ...override,
        request: { operation: 'set', salt: SALT, pinHash: PIN_2580 },
      });
    expect(call).toThrow('Invalid wallet PIN attestation input');
  });

  it.each([
    { operation: 'set', salt: SALT.toUpperCase(), pinHash: PIN_2580 },
    { operation: 'reset', salt: SALT, pinHash: 'abcd' },
    {
      operation: 'verify',
      pinHash: PIN_2580,
      purpose: 'Transfer!',
      amountKobo: 5000,
      idempotencyKeySha256: IDEM_1,
    },
    {
      operation: 'verify',
      pinHash: PIN_2580,
      purpose: 'vtu',
      amountKobo: 0,
      idempotencyKeySha256: IDEM_1,
    },
  ] as const)('refuses a malformed request field (case %#)', (request) => {
    expect(() => signWalletPinAttestation({ ...base, request })).toThrow(
      'Invalid wallet PIN attestation input'
    );
  });

  it('never embeds the pepper and refuses a foreign pepper handle', () => {
    const attestation = signWalletPinAttestation({
      ...base,
      request: { operation: 'set', salt: SALT, pinHash: PIN_2580 },
    });
    expect(attestation).toMatch(/^\d{13}\.[0-9a-f]{64}$/);
    expect(attestation).not.toContain('pepper');
    const forged = Object.freeze({ id: 'd0bc8ce070c22d11' }) as WalletPinPepper;
    expect(() =>
      signWalletPinAttestation({
        ...base,
        pepper: forged,
        request: { operation: 'set', salt: SALT, pinHash: PIN_2580 },
      })
    ).toThrow('Wallet PIN pepper unavailable');
  });
});
