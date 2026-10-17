import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('loyalty redemption key store', () => {
  it('mints a key and persists it for the intent', async () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
    });
    const { mintKey, persistedIntents } = await import(
      './loyalty-redemption-key-store'
    );

    const key = mintKey('loyalty-redeem-key:m:c:r');

    expect(store.get('loyalty-redeem-key:m:c:r')).toBe(key);
    expect(persistedIntents.has('loyalty-redeem-key:m:c:r')).toBe(true);
  });

  it('fails closed when the key cannot be persisted', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('storage disabled');
      },
      removeItem: () => {},
    });
    const { mintKey } = await import('./loyalty-redemption-key-store');

    expect(() => mintKey('loyalty-redeem-key:m:c:r')).toThrow(
      'Unable to save redemption recovery'
    );
  });
});
