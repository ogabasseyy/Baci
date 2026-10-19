import { describe, expect, it } from 'vitest';
import { stableStringify } from './stable-stringify';

describe('stableStringify', () => {
  it('serializes primitives like JSON.stringify', () => {
    expect(stableStringify(null)).toBe('null');
    expect(stableStringify('a')).toBe('"a"');
    expect(stableStringify(3)).toBe('3');
  });

  it('sorts object keys so key order never matters', () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(stableStringify({ a: 2, b: 1 })).toBe('{"a":2,"b":1}');
  });

  it('drops undefined values and sorts nested objects', () => {
    expect(stableStringify({ b: { d: 1, c: 2 }, a: undefined })).toBe(
      '{"b":{"c":2,"d":1}}'
    );
  });

  it('preserves array order while stabilizing elements', () => {
    expect(stableStringify([{ b: 1, a: 2 }, null])).toBe(
      '[{"a":2,"b":1},null]'
    );
  });
});
