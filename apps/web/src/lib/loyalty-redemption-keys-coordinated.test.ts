import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('coordinatedMint', () => {
  it('adopts an already-stored key without minting', async () => {
    const store = new Map<string, string>([
      ['intent-1', '11111111-1111-4111-8111-111111111111'],
    ]);
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
    });
    const { coordinatedMint } = await import(
      './loyalty-redemption-keys-coordinated'
    );

    await expect(coordinatedMint('intent-1')).resolves.toBe(
      '11111111-1111-4111-8111-111111111111'
    );
  });
});
