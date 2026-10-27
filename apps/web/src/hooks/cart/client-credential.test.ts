import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cartClientCredentialHeaders,
  getCartClientCredential,
} from './client-credential';

const STORAGE_KEY = 'baci:cart-client-credential';

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('getCartClientCredential', () => {
  it('generates once, persists, and reuses the credential', () => {
    const first = getCartClientCredential();
    expect(first).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(first);
    expect(getCartClientCredential()).toBe(first);
  });

  it('replaces a malformed stored value', () => {
    window.localStorage.setItem(STORAGE_KEY, 'junk');
    const credential = getCartClientCredential();
    expect(credential).not.toBe('junk');
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(credential);
  });

  it('falls back to a stable in-memory credential when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    const first = getCartClientCredential();
    expect(getCartClientCredential()).toBe(first);
  });

  it('falls back to getRandomValues when randomUUID is unavailable', () => {
    const original = crypto.randomUUID;
    // Older/insecure-context browsers lack randomUUID; cart calls
    // must still work (and still get a valid v4 credential).
    Object.defineProperty(crypto, 'randomUUID', {
      configurable: true,
      value: undefined,
    });
    try {
      const credential = getCartClientCredential();
      expect(credential).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
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
    const credential = getCartClientCredential();
    expect(cartClientCredentialHeaders()).toEqual({
      'x-baci-client-credential': credential,
    });
  });
});
