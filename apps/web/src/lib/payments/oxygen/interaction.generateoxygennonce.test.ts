import { describe, expect, it } from 'vitest';
import { generateOxygenNonce } from './interaction';

describe('generateOxygenNonce', () => {
  it('produces UUID-shaped nonces', () => {
    const uuidV4 =
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    for (let i = 0; i < 5; i += 1) {
      expect(generateOxygenNonce()).toMatch(uuidV4);
    }
  });

  it('produces unique nonces (never asserts header semantics)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i += 1) {
      seen.add(generateOxygenNonce());
    }
    expect(seen.size).toBe(100);
  });
});
