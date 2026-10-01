import { describe, expect, it } from 'vitest';
import decodeUriComponent from 'decode-uri-component';

// Regression coverage for patches/decode-uri-component@0.2.2.patch, which backports
// the upstream 0.5.0 linear-time fallback decoder to the CJS 0.2.2 line that
// query-string@7 (expo-router) requires. The advisory: malformed percent-encoded
// input triggered excessive CPU usage in the original recursive fallback.
describe('decode-uri-component DoS regression (patched 0.2.2)', () => {
  it('matches decodeURIComponent on valid input', () => {
    expect(decodeUriComponent('hello%20world')).toBe('hello world');
    expect(decodeUriComponent('%C3%A5ngstr%C3%B6m')).toBe('ångström');
    expect(decodeUriComponent('caf%C3%A9')).toBe('café');
  });

  it('keeps the 0.2.2 "+" handling that query-string relies on', () => {
    // Deliberate divergence from upstream 0.5.0, which dropped this replacement.
    expect(decodeUriComponent('a+b')).toBe('a b');
  });

  it('leaves malformed sequences literal instead of throwing', () => {
    expect(decodeUriComponent('%E0%A4%A')).toBe('%E0%A4%A');
    expect(decodeUriComponent('%C0%AF')).toBe('%C0%AF');
    expect(decodeUriComponent('100%')).toBe('100%');
  });

  it('rejects non-string input', () => {
    expect(() => decodeUriComponent(1 as unknown as string)).toThrow(TypeError);
  });

  it(
    'decodes a long valid run with a truncated tail in bounded time',
    () => {
      // Adversarial shape for the original recursive fallback: it needs ~33s for
      // 2000 units and scales catastrophically from there, while the linear
      // backport decodes 5000 units in milliseconds.
      const input = `${'%41'.repeat(5000)}%E0%A4`;
      const start = performance.now();
      const output = decodeUriComponent(input);
      const elapsedMs = performance.now() - start;

      expect(output).toBe(`${'A'.repeat(5000)}%E0%A4`);
      expect(elapsedMs).toBeLessThan(5000);
    },
    30000,
  );
});
