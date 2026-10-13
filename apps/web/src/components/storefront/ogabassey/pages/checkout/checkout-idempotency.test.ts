import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CHECKOUT_IDEMPOTENCY_STORAGE_KEY,
  CHECKOUT_IDEMPOTENCY_TTL_MS,
  clearCheckoutIdempotencyKey,
  getCheckoutIdempotencyKey,
} from './checkout-idempotency';

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value)
  );

  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');
}

describe('checkout idempotency key storage', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.spyOn(Date, 'now').mockReturnValue(1_000);
    vi.spyOn(crypto, 'randomUUID')
      .mockReturnValueOnce('11111111-1111-4111-8111-111111111111')
      .mockReturnValueOnce('22222222-2222-4222-8222-222222222222');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it('reuses the key for the same checkout fingerprint', async () => {
    await expect(getCheckoutIdempotencyKey('fingerprint-a')).resolves.toBe(
      '11111111-1111-4111-8111-111111111111'
    );
    await expect(getCheckoutIdempotencyKey('fingerprint-a')).resolves.toBe(
      '11111111-1111-4111-8111-111111111111'
    );
  });

  it('rotates the key when the checkout fingerprint changes', async () => {
    await expect(getCheckoutIdempotencyKey('fingerprint-a')).resolves.toBe(
      '11111111-1111-4111-8111-111111111111'
    );
    await expect(getCheckoutIdempotencyKey('fingerprint-b')).resolves.toBe(
      '22222222-2222-4222-8222-222222222222'
    );
  });

  it('stores the fingerprint hash, key, and createdAt in local storage', async () => {
    await getCheckoutIdempotencyKey('fingerprint-a');

    const stored = JSON.parse(
      window.localStorage.getItem(CHECKOUT_IDEMPOTENCY_STORAGE_KEY) || '{}'
    );

    expect(stored).toEqual({
      checkoutFingerprintHash: await sha256Hex('fingerprint-a'),
      createdAt: 1_000,
      key: '11111111-1111-4111-8111-111111111111',
    });
    expect(stored).not.toHaveProperty('checkoutFingerprint');
    expect(
      JSON.parse(
        window.localStorage.getItem(CHECKOUT_IDEMPOTENCY_STORAGE_KEY) || '{}'
      ).checkoutFingerprintHash
    ).not.toBe('fingerprint-a');
  });

  it('recovers from malformed stored JSON by replacing it with a fresh key', async () => {
    window.localStorage.setItem(CHECKOUT_IDEMPOTENCY_STORAGE_KEY, '{not-json');

    await expect(getCheckoutIdempotencyKey('fingerprint-a')).resolves.toBe(
      '11111111-1111-4111-8111-111111111111'
    );
    expect(
      JSON.parse(
        window.localStorage.getItem(CHECKOUT_IDEMPOTENCY_STORAGE_KEY) || '{}'
      )
    ).toEqual({
      checkoutFingerprintHash: await sha256Hex('fingerprint-a'),
      createdAt: 1_000,
      key: '11111111-1111-4111-8111-111111111111',
    });
  });

  it('replaces stored objects with missing or invalid fields', async () => {
    window.localStorage.setItem(
      CHECKOUT_IDEMPOTENCY_STORAGE_KEY,
      JSON.stringify({
        checkoutFingerprint: { value: 'fingerprint-a' },
        createdAt: 1_000,
        key: 123,
      })
    );

    await expect(getCheckoutIdempotencyKey('fingerprint-a')).resolves.toBe(
      '11111111-1111-4111-8111-111111111111'
    );
    const stored = JSON.parse(
      window.localStorage.getItem(CHECKOUT_IDEMPOTENCY_STORAGE_KEY) || '{}'
    );

    expect(stored).toEqual({
      checkoutFingerprintHash: await sha256Hex('fingerprint-a'),
      createdAt: 1_000,
      key: '11111111-1111-4111-8111-111111111111',
    });
    expect(
      JSON.parse(
        window.localStorage.getItem(CHECKOUT_IDEMPOTENCY_STORAGE_KEY) || '{}'
      ).checkoutFingerprint
    ).toBeUndefined();
  });

  it('blocks another order when storage reads fail', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage read failed');
    });

    await expect(getCheckoutIdempotencyKey('fingerprint-a')).rejects.toThrow(
      'Unable to read checkout recovery'
    );
  });

  it('blocks initiation when recovery cannot be saved', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage write failed');
    });

    await expect(getCheckoutIdempotencyKey('fingerprint-a')).rejects.toThrow(
      'Unable to save checkout recovery'
    );
    expect(
      window.localStorage.getItem(CHECKOUT_IDEMPOTENCY_STORAGE_KEY)
    ).toBeNull();
  });

  it('rejects blank fingerprints without creating an untraceable attempt', async () => {
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem');
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');

    await expect(getCheckoutIdempotencyKey('   ')).rejects.toThrow(
      'Unable to preserve checkout recovery'
    );
    expect(getItemSpy).not.toHaveBeenCalled();
    expect(setItemSpy).not.toHaveBeenCalled();
  });

  it('rotates the key after the TTL expires', async () => {
    await expect(getCheckoutIdempotencyKey('fingerprint-a')).resolves.toBe(
      '11111111-1111-4111-8111-111111111111'
    );

    vi.mocked(Date.now).mockReturnValue(
      1_000 + CHECKOUT_IDEMPOTENCY_TTL_MS + 1
    );

    await expect(getCheckoutIdempotencyKey('fingerprint-a')).resolves.toBe(
      '22222222-2222-4222-8222-222222222222'
    );
  });

  it('clears only the matching stored fingerprint', async () => {
    await getCheckoutIdempotencyKey('fingerprint-a');
    await clearCheckoutIdempotencyKey('fingerprint-b');
    expect(
      window.localStorage.getItem(CHECKOUT_IDEMPOTENCY_STORAGE_KEY)
    ).not.toBeNull();

    await clearCheckoutIdempotencyKey('fingerprint-a');
    expect(
      window.localStorage.getItem(CHECKOUT_IDEMPOTENCY_STORAGE_KEY)
    ).toBeNull();
  });

  it('does not throw when clearing fails because storage is unavailable', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage read failed');
    });
    await expect(
      clearCheckoutIdempotencyKey('fingerprint-a')
    ).resolves.toBeUndefined();

    vi.restoreAllMocks();
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('storage remove failed');
    });
    await expect(clearCheckoutIdempotencyKey()).resolves.toBeUndefined();
  });
});
