import { describe, expect, it } from 'vitest';
import { chunkArray } from './chunk-array';

describe('chunkArray', () => {
  it.each([
    [[], 1000, []],
    [['a'], 1000, [['a']]],
    [['a', 'b', 'c'], 2, [['a', 'b'], ['c']]],
    [
      ['a', 'b', 'c', 'd'],
      2,
      [
        ['a', 'b'],
        ['c', 'd'],
      ],
    ],
  ])('chunks %s by %s', (items, size, expected) => {
    expect(chunkArray(items, size)).toEqual(expected);
  });

  it('caps chunks at the Supabase remove object limit', () => {
    const paths = Array.from({ length: 2500 }, (_, index) => `p${index}`);
    const chunks = chunkArray(paths, 1000);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toHaveLength(1000);
    expect(chunks[1]).toHaveLength(1000);
    expect(chunks[2]).toHaveLength(500);
  });
});
