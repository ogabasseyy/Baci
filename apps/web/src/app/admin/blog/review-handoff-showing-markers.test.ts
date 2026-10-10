import { describe, expect, it } from 'vitest';
import { showingMarkers } from './review-handoff-showing-markers';

const NONE = [false, false, false, false, false, false];
const ALL = [true, true, true, true, true, true];
const BELOW_MD = [true, true, false, false, false, false];
const NULLS = [null, null, null, null, null, null];

describe('showingMarkers', () => {
  it('reports no markers for an empty class list', () => {
    expect(showingMarkers([])).toEqual({
      colorAt: NULLS,
      terminalAt: NONE,
      visibilityAt: NULLS,
    });
  });

  it.each([
    [['hidden'], ALL],
    [['hidden', 'md:block'], BELOW_MD],
    [['hidden', 'md:block', 'md:hidden'], ALL],
    [['sr-only'], ALL],
    [['sr-only', 'md:not-sr-only'], BELOW_MD],
    [['opacity-0'], ALL],
    [['opacity-0', 'md:opacity-100'], BELOW_MD],
    [
      ['opacity-100', 'md:opacity-0'],
      [false, false, true, true, true, true],
    ],
    [['scale-x-0'], ALL],
    [['scale-x-0', 'md:scale-x-100'], BELOW_MD],
    [['scale-0', 'md:scale-100'], BELOW_MD],
    [['h-0', 'overflow-hidden'], ALL],
    [['h-0', 'overflow-hidden', 'md:h-auto'], BELOW_MD],
    [['max-h-0', 'overflow-hidden', 'md:h-auto'], ALL],
    [['w-0', 'overflow-x-clip'], ALL],
    [['h-0', 'overflow-x-hidden'], NONE],
    [['hidden', 'block!'], NONE],
    [['block', 'hidden!'], ALL],
    [['hidden', 'md:block!'], BELOW_MD],
    [['opacity-0', 'opacity-100!'], NONE],
    [['scale-0', 'scale-100!'], NONE],
    [['h-0', 'overflow-hidden', 'h-64!'], NONE],
  ])('unions hiding channels per point: %s', (classes, expected) => {
    expect(showingMarkers(classes).terminalAt).toEqual(expected);
  });

  it.each([
    [
      ['invisible'],
      [
        'invisible',
        'invisible',
        'invisible',
        'invisible',
        'invisible',
        'invisible',
      ],
    ],
    [
      ['visible'],
      ['visible', 'visible', 'visible', 'visible', 'visible', 'visible'],
    ],
    [['md:visible'], [null, null, 'visible', 'visible', 'visible', 'visible']],
    [
      ['invisible', 'md:visible'],
      ['invisible', 'invisible', 'visible', 'visible', 'visible', 'visible'],
    ],
  ])('tracks inherited visibility per point: %s', (classes, expected) => {
    expect(showingMarkers(classes).visibilityAt).toEqual(expected);
  });

  it.each([
    [
      ['text-black'],
      ['opaque', 'opaque', 'opaque', 'opaque', 'opaque', 'opaque'],
    ],
    [
      ['text-transparent'],
      [
        'transparent',
        'transparent',
        'transparent',
        'transparent',
        'transparent',
        'transparent',
      ],
    ],
    [
      ['md:text-transparent'],
      [null, null, 'transparent', 'transparent', 'transparent', 'transparent'],
    ],
    [
      ['text-black', 'md:text-transparent'],
      [
        'opaque',
        'opaque',
        'transparent',
        'transparent',
        'transparent',
        'transparent',
      ],
    ],
    [
      ['bg-red-500', 'bg-clip-text', 'text-transparent'],
      ['opaque', 'opaque', 'opaque', 'opaque', 'opaque', 'opaque'],
    ],
    [['text-current'], NULLS],
  ])('tracks inherited color per point: %s', (classes, expected) => {
    expect(showingMarkers(classes).colorAt).toEqual(expected);
  });

  it('ignores non-marker tokens', () => {
    expect(showingMarkers(['foo', 'text-sm', 'hover:block'])).toEqual({
      colorAt: NULLS,
      terminalAt: NONE,
      visibilityAt: NULLS,
    });
  });
});
