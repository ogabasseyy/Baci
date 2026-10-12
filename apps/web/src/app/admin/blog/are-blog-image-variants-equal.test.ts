import { describe, expect, it } from 'vitest';
import { areBlogImageVariantsEqual } from './are-blog-image-variants-equal';

describe('areBlogImageVariantsEqual', () => {
  it.each([null, undefined, {}])('treats %s as an empty map', (empty) => {
    expect(areBlogImageVariantsEqual(empty, {})).toBe(true);
    expect(areBlogImageVariantsEqual({}, empty)).toBe(true);
  });
  it('compares entries independently of insertion order', () => {
    expect(
      areBlogImageVariantsEqual(
        { square: 'a', landscape: 'b' },
        { landscape: 'b', square: 'a' }
      )
    ).toBe(true);
  });
  it.each([
    [{ square: 'a' }, {}],
    [{ square: 'a' }, { square: 'b' }],
    [{ square: 'a' }, { landscape: 'a' }],
  ])('detects differing entries', (left, right) => {
    expect(areBlogImageVariantsEqual(left, right)).toBe(false);
    expect(areBlogImageVariantsEqual(right, left)).toBe(false);
  });
  it('does not treat an inherited entry as an own variant', () => {
    const inherited = Object.create({ square: 'a' }) as Record<string, unknown>;
    inherited.landscape = 'b';
    expect(areBlogImageVariantsEqual({ square: 'a' }, inherited)).toBe(false);
  });
});
