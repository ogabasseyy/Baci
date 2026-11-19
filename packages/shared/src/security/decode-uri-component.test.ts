import decodeUriComponent from 'decode-uri-component';
import { describe, expect, it } from 'vitest';

// The decoder is a dev-only dependency; no current query-string consumer needs
// the old CJS/plus behavior. Use upstream 0.5.1, which fixes both fallback DoS paths.
describe('decode-uri-component DoS regression (upstream 0.5.1)', () => {
  it('matches decodeURIComponent on valid input', () => {
    expect(decodeUriComponent('hello%20world')).toBe('hello world');
    expect(decodeUriComponent('%C3%A5ngstr%C3%B6m')).toBe('ångström');
    expect(decodeUriComponent('caf%C3%A9')).toBe('café');
  });

  it('preserves literal plus signs as upstream specifies', () => {
    expect(decodeUriComponent('a+b')).toBe('a+b');
  });

  it('leaves malformed sequences literal instead of throwing', () => {
    expect(decodeUriComponent('%E0%A4%A')).toBe('%E0%A4%A');
    expect(decodeUriComponent('%C0%AF')).toBe('%C0%AF');
    expect(decodeUriComponent('100%')).toBe('100%');
  });

  it('decodes many distinct runs without repeated whole-input replacement', () => {
    const input = `${Array.from({ length: 32000 }, (_, i) => {
      const hex = i.toString(16).padStart(4, '0');
      return `%${hex.slice(0, 2)}%${hex.slice(2)}x`;
    }).join('')}%zz`;
    const start = performance.now();
    const output = decodeUriComponent(input);
    expect(output.endsWith('%zz')).toBe(true);
    expect(performance.now() - start).toBeLessThan(5000);
  });

  it('rejects non-string input', () => {
    expect(() => decodeUriComponent(1 as unknown as string)).toThrow(TypeError);
  });

  it('decodes a long valid run with a truncated tail in bounded time', () => {
    // Adversarial shape for the original recursive fallback: it needs ~33s for
    // 2000 units and scales catastrophically from there, while the linear
    // backport decodes 5000 units in milliseconds.
    const input = `${'%41'.repeat(5000)}%E0%A4`;
    const start = performance.now();
    const output = decodeUriComponent(input);
    const elapsedMs = performance.now() - start;

    expect(output).toBe(`${'A'.repeat(5000)}%E0%A4`);
    expect(elapsedMs).toBeLessThan(5000);
  }, 30000);
});
