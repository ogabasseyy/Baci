import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cartClientCredentialHeaders,
  getCartClientCredential,
} from './client-credential';

const STORAGE_KEY = 'baci:cart-client-credential';
const FIXED_UUID = '44444444-4444-4444-8444-444444444444';

beforeEach(() => {
  vi.spyOn(crypto, 'randomUUID').mockReturnValue(
    FIXED_UUID as `${string}-${string}-${string}-${string}-${string}`
  );
});

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('getCartClientCredential', () => {
  it('generates once, persists, and reuses the credential', () => {
    expect(getCartClientCredential()).toBe(FIXED_UUID);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(FIXED_UUID);
    expect(getCartClientCredential()).toBe(FIXED_UUID);
  });

  it('replaces a malformed stored value', () => {
    window.localStorage.setItem(STORAGE_KEY, 'junk');
    expect(getCartClientCredential()).toBe(FIXED_UUID);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(FIXED_UUID);
  });

  it('falls back to a stable in-memory credential when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(getCartClientCredential()).toBe(FIXED_UUID);
    expect(getCartClientCredential()).toBe(FIXED_UUID);
  });

  it('falls back to getRandomValues when randomUUID is unavailable', () => {
    const original = crypto.randomUUID;
    // Older/insecure-context browsers lack randomUUID; cart calls
    // must still work (and still get a valid v4 credential).
    Object.defineProperty(crypto, 'randomUUID', {
      configurable: true,
      value: undefined,
    });
    vi.spyOn(crypto, 'getRandomValues').mockImplementation((array) => {
      const bytes = array as Uint8Array;
      bytes.fill(0x44);
      return array;
    });
    try {
      expect(getCartClientCredential()).toBe(
        '44444444-4444-4444-8444-444444444444'
      );
    } finally {
      Object.defineProperty(crypto, 'randomUUID', {
        configurable: true,
        value: original,
      });
    }
  });

  it('omits the header instead of throwing when crypto fails entirely', () => {
    vi.spyOn(crypto, 'randomUUID').mockImplementation(() => {
      throw new Error('unavailable');
    });
    vi.spyOn(crypto, 'getRandomValues').mockImplementation(() => {
      throw new Error('unavailable');
    });
    expect(getCartClientCredential()).toBeNull();
    expect(cartClientCredentialHeaders()).toEqual({});
  });

  it('exposes the credential under the shared header name', () => {
    expect(cartClientCredentialHeaders()).toEqual({
      'x-baci-client-credential': FIXED_UUID,
    });
  });
});
