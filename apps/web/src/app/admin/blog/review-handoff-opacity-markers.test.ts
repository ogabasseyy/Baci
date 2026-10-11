import { describe, expect, it } from 'vitest';
import { opacityMarkers } from './review-handoff-opacity-markers';

const ALL = [true, true, true, true, true, true];
const NONE = [false, false, false, false, false, false];
const MD_UP = [false, false, true, true, true, true];
const BELOW_MD = [true, true, false, false, false, false];

describe('opacityMarkers', () => {
  it.each([
    [['opacity-0'], ALL],
    [['opacity-[0]'], ALL],
    [['opacity-0', 'opacity-[0]'], ALL],
    [['md:opacity-0'], MD_UP],
    [['opacity-0', 'md:opacity-0'], ALL],
    [['opacity-100', 'md:opacity-0'], MD_UP],
    [['opacity-0', 'md:opacity-100'], BELOW_MD],
    [['opacity-0', 'md:opacity-0', 'md:opacity-100'], BELOW_MD],
    [['opacity-[0]', 'md:opacity-100'], BELOW_MD],
    [['opacity-100', 'opacity-0!'], ALL],
    [['opacity-0', 'md:opacity-100!'], BELOW_MD],
  ])('reports zero opacity per point: %s', (classes, expected) => {
    expect(opacityMarkers(classes).zeroAt).toEqual(expected);
  });

  it.each([
    [[]],
    [['opacity-100']],
    [['opacity-0', 'opacity-100']],
    [['opacity-0', 'opacity-50']],
    [['opacity-[var(--alpha)]']],
    [['md:opacity-100']],
    [['opacity-0', 'opacity-100!']],
    [['md:opacity-0', 'opacity-100!']],
    [['hover:opacity-0']],
  ])('reports no zero without a zero winner: %s', (classes) => {
    expect(opacityMarkers(classes).zeroAt).toEqual(NONE);
  });
});
