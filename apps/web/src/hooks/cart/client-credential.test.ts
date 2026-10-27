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

  it('exposes the credential under the shared header name', () => {
    const credential = getCartClientCredential();
    expect(cartClientCredentialHeaders()).toEqual({
      'x-baci-client-credential': credential,
    });
  });
});
