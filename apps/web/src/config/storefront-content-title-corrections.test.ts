import { describe, expect, it } from 'vitest';
import { JOINED_TITLE_CORRECTIONS } from './storefront-content-title-corrections';

describe('JOINED_TITLE_CORRECTIONS', () => {
  it('canonicalizes compact catalog spellings used by guide matching', () => {
    expect(JOINED_TITLE_CORRECTIONS).toMatchObject({
      airpod: 'airpods',
      donkeykong: 'donkey kong',
    });
  });
});
