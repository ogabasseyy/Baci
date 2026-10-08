import { describe, expect, it } from 'vitest';
import { sizeMarkers } from './review-handoff-size-markers';

// Six chars per expectation: base, sm, md, lg, xl, 2xl.
function flags(values: boolean[]): string {
  return values.map((value) => (value ? 'T' : 'F')).join('');
}

describe('sizeMarkers', () => {
  it.each([
    ['zero height', ['h-0'], 'TTTTTT', 'FFFFFF', 'FFFFFF', 'FFFFFF'],
    ['zero width', ['w-0'], 'FFFFFF', 'TTTTTT', 'FFFFFF', 'FFFFFF'],
    ['zero size', ['size-0'], 'TTTTTT', 'TTTTTT', 'FFFFFF', 'FFFFFF'],
    ['zero max', ['max-h-0'], 'TTTTTT', 'FFFFFF', 'FFFFFF', 'FFFFFF'],
    ['natural winner', ['h-0', 'h-20'], 'FFFFFF', 'FFFFFF', 'FFFFFF', 'FFFFFF'],
    [
      'axis beats size',
      ['size-0', 'h-auto'],
      'FFFFFF',
      'TTTTTT',
      'FFFFFF',
      'FFFFFF',
    ],
    [
      'min beats max',
      ['max-h-0', 'min-h-screen'],
      'FFFFFF',
      'FFFFFF',
      'FFFFFF',
      'FFFFFF',
    ],
    [
      'max caps height',
      ['max-h-0', 'h-screen'],
      'TTTTTT',
      'FFFFFF',
      'FFFFFF',
      'FFFFFF',
    ],
    [
      'responsive restore',
      ['h-0', 'md:h-auto'],
      'TTFFFF',
      'FFFFFF',
      'FFFFFF',
      'FFFFFF',
    ],
    [
      'max survives restore',
      ['max-h-0', 'md:h-auto'],
      'TTTTTT',
      'FFFFFF',
      'FFFFFF',
      'FFFFFF',
    ],
    [
      'clip both axes',
      ['overflow-hidden'],
      'FFFFFF',
      'FFFFFF',
      'TTTTTT',
      'TTTTTT',
    ],
    [
      'clip vertical',
      ['overflow-y-hidden'],
      'FFFFFF',
      'FFFFFF',
      'FFFFFF',
      'TTTTTT',
    ],
    ['no clip', ['overflow-visible'], 'FFFFFF', 'FFFFFF', 'FFFFFF', 'FFFFFF'],
    [
      'clip loses naturally',
      ['overflow-hidden', 'overflow-visible'],
      'FFFFFF',
      'FFFFFF',
      'FFFFFF',
      'FFFFFF',
    ],
    [
      'axis clip wins',
      ['overflow-hidden', 'overflow-x-visible'],
      'FFFFFF',
      'FFFFFF',
      'FFFFFF',
      'TTTTTT',
    ],
  ])('%s: %s', (_name, classes, heightZero, widthZero, clipsX, clipsY) => {
    const markers = sizeMarkers(classes as string[]);
    expect(flags(markers.heightZeroAt)).toBe(heightZero);
    expect(flags(markers.widthZeroAt)).toBe(widthZero);
    expect(flags(markers.clipsXAt)).toBe(clipsX);
    expect(flags(markers.clipsYAt)).toBe(clipsY);
  });
});
