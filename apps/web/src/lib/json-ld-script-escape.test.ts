import { describe, expect, it } from 'vitest';
import { safeJsonLdStringify } from './json-ld-script-escape';
import { safeJsonLdStringify as legacyStringify } from './sanitize-json-ld';

const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);
const LONE = String.fromCharCode(0xde00);
const EMOJI = String.fromCodePoint(0x1f600);

describe('safeJsonLdStringify (dependency-free escaper)', () => {
  it('neutralizes script breakouts without changing parsed data', () => {
    const input = { a: '</script><script>alert(1)</script>' };
    const out = safeJsonLdStringify(input);

    expect(out).not.toContain('</script');
    expect(out).toContain('u003c/script');
    expect(JSON.parse(out)).toEqual(input);
  });

  it('escapes ampersands and line/paragraph separators', () => {
    const out = safeJsonLdStringify({ a: `fish & chips${LS}${PS}` });

    expect(out).toContain('u0026');
    expect(out).not.toContain(LS);
    expect(out).not.toContain(PS);
  });

  it('repairs lone surrogates while preserving valid astral characters', () => {
    const out = safeJsonLdStringify({ a: `bad${LONE}char ${EMOJI}` });

    expect(out).toContain(EMOJI);
    expect(() => JSON.parse(out)).not.toThrow();
  });

  it('returns an empty string for undefined schemas', () => {
    expect(safeJsonLdStringify(undefined)).toBe('');
  });

  it('matches the legacy module output exactly (split safety)', () => {
    const inputs: unknown[] = [
      { a: '</script>' },
      { o: { k: '<b>x</b>' }, arr: ['<i>', `x${LS}y`] },
      { n: 1, b: false, z: null },
      undefined,
    ];

    for (const input of inputs) {
      expect(safeJsonLdStringify(input)).toBe(legacyStringify(input));
    }
  });
});
