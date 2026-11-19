import { boundedMapSet } from './bounded-map-set';

describe('boundedMapSet', () => {
  it('keeps at most the capacity, dropping the oldest key', () => {
    const map = new Map<string, number>();
    boundedMapSet(map, 'a', 1, 2);
    boundedMapSet(map, 'b', 2, 2);
    boundedMapSet(map, 'c', 3, 2);
    expect([...map.keys()]).toEqual(['b', 'c']);
  });

  it('moves a re-set key to the newest position', () => {
    const map = new Map<string, number>();
    boundedMapSet(map, 'a', 1, 2);
    boundedMapSet(map, 'b', 2, 2);
    boundedMapSet(map, 'a', 9, 2);
    boundedMapSet(map, 'c', 3, 2);
    expect([...map.entries()]).toEqual([
      ['a', 9],
      ['c', 3],
    ]);
  });
});
