import { describe, expect, it } from 'vitest';
import { visibilityMarkers } from './review-handoff-visibility-markers';

// Six chars per expectation: base, sm, md, lg, xl, 2xl. Visibility
// uses V (visible), I (invisible), - (absent).
function visibilityFlags(values: (string | null)[]): string {
  return values
    .map((value) => (value === null ? '-' : value === 'visible' ? 'V' : 'I'))
    .join('');
}

function flags(values: boolean[]): string {
  return values.map((value) => (value ? 'T' : 'F')).join('');
}

describe('visibilityMarkers', () => {
  it.each([
    ['visible', ['visible'], 'VVVVVV', 'FFFFFF'],
    ['invisible', ['invisible'], 'IIIIII', 'FFFFFF'],
    ['visible wins', ['invisible', 'visible'], 'VVVVVV', 'FFFFFF'],
    ['responsive escape', ['invisible', 'md:visible'], 'IIVVVV', 'FFFFFF'],
    ['responsive hide', ['md:invisible'], '--IIII', 'FFFFFF'],
    ['narrow hide', ['max-md:invisible'], 'II----', 'FFFFFF'],
    ['screen reader only', ['sr-only'], '------', 'TTTTTT'],
    ['screen restore', ['sr-only', 'not-sr-only'], '------', 'FFFFFF'],
    [
      'responsive screen restore',
      ['sr-only', 'md:not-sr-only'],
      '------',
      'TTFFFF',
    ],
  ])('%s: %s', (_name, classes, visible, screenReader) => {
    const markers = visibilityMarkers(classes as string[]);
    expect(visibilityFlags(markers.visibleAt)).toBe(visible);
    expect(flags(markers.screenReaderOnlyAt)).toBe(screenReader);
  });
});
