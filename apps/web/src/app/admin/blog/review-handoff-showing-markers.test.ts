import { describe, expect, it } from 'vitest';
import { showingMarkers } from './review-handoff-showing-markers';

describe('showingMarkers', () => {
  it('reports no markers for an empty class list', () => {
    expect(showingMarkers([])).toEqual({
      baseHeightRestored: false,
      baseWidthRestored: false,
      clippedBackground: false,
      display: false,
      heightRestored: false,
      maxHeightRestored: false,
      maxWidthRestored: false,
      notSrOnly: false,
      opacity: false,
      opaqueColor: false,
      scaleXRestored: false,
      scaleXZero: false,
      scaleYRestored: false,
      scaleYZero: false,
      transparentColor: false,
      visible: false,
      widthRestored: false,
    });
  });

  it.each([
    [['hidden', 'md:block'], { display: true }],
    [['hidden', 'md:block', 'md:hidden'], { display: false }],
    [['md:block', 'lg:hidden'], { display: true }],
    [['block'], { display: false }],
    [['visible'], { visible: true }],
    [['md:visible'], { visible: true }],
    [['md:opacity-100'], { opacity: true }],
    [['md:opacity-0'], { opacity: false }],
    [['md:opacity-[var(--o)]'], { opacity: true }],
    [['opacity-100'], { opacity: true }],
    [['opacity-0', 'opacity-100'], { opacity: true }],
    [['opacity-0', 'opacity-50'], { opacity: true }],
    [['opacity-0', 'opacity-[0]'], { opacity: false }],
    [['opacity-0', 'opacity-[0%]'], { opacity: false }],
    [['opacity-0', 'opacity-foo'], { opacity: false }],
    [['opacity-foo'], { opacity: false }],
    [['opacity-0', 'md:opacity-0', 'md:opacity-100'], { opacity: true }],
    [['opacity-0', 'md:opacity-0'], { opacity: false }],
    [['not-sr-only'], { notSrOnly: true }],
    [['md:not-sr-only'], { notSrOnly: true }],
    [['md:h-auto'], { heightRestored: true, maxHeightRestored: false }],
    [['md:h-0'], { heightRestored: false }],
    [['md:min-h-screen'], { heightRestored: true, maxHeightRestored: true }],
    [['md:max-h-full'], { maxHeightRestored: true, heightRestored: false }],
    [['min-h-screen'], { baseHeightRestored: true, maxHeightRestored: true }],
    [['h-screen'], { baseHeightRestored: true, maxHeightRestored: false }],
    [['max-h-full'], { baseHeightRestored: false, maxHeightRestored: false }],
    [['md:h-auto'], { baseHeightRestored: false }],
    [['md:w-auto'], { widthRestored: true, maxWidthRestored: false }],
    [['md:max-w-full'], { maxWidthRestored: true, widthRestored: false }],
    [['min-w-full'], { baseWidthRestored: true, maxWidthRestored: true }],
    [['size-4'], { baseHeightRestored: true, baseWidthRestored: true }],
    [['md:size-4'], { heightRestored: true, widthRestored: true }],
    [['scale-x-0'], { scaleXZero: true, scaleYZero: false }],
    [['scale-0'], { scaleXZero: true, scaleYZero: true }],
    [['scale-x-[0]'], { scaleXZero: true }],
    [['scale-x-100'], { scaleXZero: false }],
    [['md:scale-x-100'], { scaleXRestored: true, scaleYRestored: false }],
    [['md:scale-100'], { scaleXRestored: true, scaleYRestored: true }],
    [['md:scale-none'], { scaleXRestored: true, scaleYRestored: true }],
    [['md:scale-x-0'], { scaleXRestored: false }],
    [['scale-none'], { scaleXRestored: false, scaleYRestored: false }],
    [['scale-x-0', 'scale-x-100'], { scaleXZero: false }],
    [['scale-0', 'scale-x-100'], { scaleXZero: false, scaleYZero: true }],
    [['scale-x-0', 'scale-none'], { scaleXZero: false }],
    [['scale-[0]'], { scaleXZero: true, scaleYZero: true }],
    [['scale-[0]', 'scale-none'], { scaleXZero: false, scaleYZero: false }],
    [['scale-x-100', 'scale-[0]'], { scaleXZero: true, scaleYZero: true }],
    [['scale-x-0', '-scale-x-100'], { scaleXZero: true }],
    [['scale-x-[0]', 'scale-x-100'], { scaleXZero: true }],
    [['scale-y-0', 'scale-100'], { scaleXZero: false, scaleYZero: true }],
    [['scale-x-[var(--x)]'], { scaleXZero: false }],
  ])('tracks display, visibility, size, and scale markers: %s', (classes, expected) => {
    expect(showingMarkers(classes)).toMatchObject(expected);
  });

  it.each([
    [['text-black'], { opaqueColor: true, transparentColor: false }],
    [['text-transparent'], { opaqueColor: false, transparentColor: true }],
    [
      ['bg-red-500', 'bg-clip-text', 'text-transparent'],
      { clippedBackground: true },
    ],
    [['text-black'], { clippedBackground: false }],
  ])('delegates text color markers: %s', (classes, expected) => {
    expect(showingMarkers(classes)).toMatchObject(expected);
  });

  it('ignores non-marker tokens', () => {
    expect(showingMarkers(['foo', 'text-sm', 'hover:block'])).toMatchObject({
      display: false,
      heightRestored: false,
      opaqueColor: false,
      widthRestored: false,
    });
  });
});
