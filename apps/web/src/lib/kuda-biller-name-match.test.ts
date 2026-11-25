import { describe, expect, it } from 'vitest';
import type { Biller } from './kuda';
import { chosenListings } from './kuda-biller-name-match';

const listing = (...names: string[]) =>
  names.map((billerName) => ({ biller: { billerName } as Biller }));

const pick = (names: string[], sent: string) =>
  chosenListings(listing(...names), sent).map(
    ({ biller }) => biller.billerName
  );

describe('chosenListings', () => {
  it('prefers a literal name match', () => {
    expect(pick(['DSTV', 'DSTV - PREMIUM'], 'DSTV - PREMIUM')).toEqual([
      'DSTV - PREMIUM',
    ]);
  });

  it('uses only the longest listed prefix of a decorated name', () => {
    expect(
      pick(['DSTV', 'DSTV - PREMIUM'], 'DSTV - PREMIUM - Monthly')
    ).toEqual(['DSTV - PREMIUM']);
  });

  it('matches a decorated name to its single listed biller', () => {
    expect(pick(['GOTV'], 'GOTV - Monthly')).toEqual(['GOTV']);
  });

  it('ignores case and extra spaces', () => {
    expect(pick(['DStv  Premium'], 'dstv premium')).toEqual(['DStv  Premium']);
  });

  it('returns nothing when no listed biller matches', () => {
    expect(pick(['GOTV'], 'DSTV')).toEqual([]);
  });

  it('never treats a shared word prefix as a match', () => {
    expect(pick(['DSTV'], 'DSTVX')).toEqual([]);
  });

  it('prefers an exact provider-tagged biller over a decorated shorter one', () => {
    // "DSTV - PREMIUM (Kuda)" is shown as "DSTV - PREMIUM"; the plain "DSTV"
    // must not capture it as a "PREMIUM" path.
    expect(pick(['DSTV', 'DSTV - PREMIUM (Kuda)'], 'DSTV - PREMIUM')).toEqual([
      'DSTV - PREMIUM (Kuda)',
    ]);
  });
});
