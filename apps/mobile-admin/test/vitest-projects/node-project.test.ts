import { describe, expect, it } from 'vitest';

// A plain `.ts` test without a docblock runs in the `node` Vitest project of
// vitest.config.ts: Node globals only, no DOM.
describe('mobile admin node Vitest project wiring', () => {
  it('runs in Node without a DOM', () => {
    expect(typeof window).toBe('undefined');
    expect(typeof document).toBe('undefined');
  });

  it('keeps the shared options: Vitest globals are on', () => {
    expect(typeof (globalThis as { it?: unknown }).it).toBe('function');
  });

  it('keeps the shared aliases: react-native resolves to react-native-web', async () => {
    const { Platform } = await import('react-native');

    expect(Platform.OS).toBe('web');
  });
});
