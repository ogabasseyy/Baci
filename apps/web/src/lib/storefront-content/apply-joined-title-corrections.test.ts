import { describe, expect, it } from 'vitest';
import { JOINED_TITLE_CORRECTIONS } from '@/config/storefront-content-title-corrections';
import { applyJoinedTitleCorrections } from './apply-joined-title-corrections';

describe('applyJoinedTitleCorrections', () => {
  it('covers every configured correction', () => {
    expect(Object.keys(JOINED_TITLE_CORRECTIONS).sort()).toEqual([
      'airpod',
      'donkeykong',
    ]);
    for (const [title, correction] of Object.entries(
      JOINED_TITLE_CORRECTIONS
    )) {
      expect(applyJoinedTitleCorrections(title)).toBe(correction);
    }
  });

  it.each([
    ['AIRPOD airpod AirPod', 'airpods airpods airpods'],
    ['(donkeykong), airpod-airpod!', '(donkey kong), airpods-airpods!'],
    ['_airpod airpod2 2airpod airpods', '_airpod airpod2 2airpod airpods'],
    ['donKeykong', 'donkey kong'],
  ])('preserves global Unicode word boundaries for %j', (input, expected) => {
    expect(applyJoinedTitleCorrections(input)).toBe(expected);
  });
  it('expands configured joined titles without changing unrelated text', () => {
    expect(applyJoinedTitleCorrections('donkeykong switch')).toBe(
      'donkey kong switch'
    );
    expect(applyJoinedTitleCorrections('donkeykongx switch')).toBe(
      'donkeykongx switch'
    );
  });

  it('expands mixed-case joined titles from imported catalog names', () => {
    const input = 'DonkeyKong Country Returns HD';
    const result = applyJoinedTitleCorrections(input);

    expect(result).toBe('donkey kong Country Returns HD');
  });
});
