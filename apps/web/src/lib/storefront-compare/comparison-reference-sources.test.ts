import { describe, expect, it } from 'vitest';
import { getComparisonReferenceSources } from './comparison-reference-sources';

describe('getComparisonReferenceSources', () => {
  it('does not borrow another model source when an exact listing has no reference', () => {
    expect(
      getComparisonReferenceSources(['jbl-go-3', 'airpods-3', 'unknown'])
    ).toEqual([]);
  });
  it('deduplicates the common Valve sheet while retaining different AirPods model evidence', () => {
    const sources = getComparisonReferenceSources([
      'steam-deck',
      'steam-deck-oled',
      'airpods-4',
      'apple-airpods-4-anc',
    ]);
    expect(sources.map((source) => source.href)).toEqual([
      'https://www.steamdeck.com/en/tech/oled',
      'https://support.apple.com/en-us/121203',
      'https://support.apple.com/en-us/121204',
    ]);
  });
});
