import { describe, expect, it } from 'vitest';
import { displayMarkers } from './review-handoff-display-markers';

const ALL = [true, true, true, true, true, true];
const NONE = [false, false, false, false, false, false];
const BELOW_MD = [true, true, false, false, false, false];

describe('displayMarkers', () => {
  it.each([
    [['hidden'], ALL],
    [['md:hidden'], [false, false, true, true, true, true]],
    [['hidden', 'md:block'], BELOW_MD],
    [['hidden', 'block'], ALL],
    [['block', 'hidden'], ALL],
    [['hidden', 'md:block', 'md:hidden'], ALL],
    [
      ['hidden', 'md:block', 'lg:hidden'],
      [true, true, false, true, true, true],
    ],
    [
      ['md:hidden', 'lg:block'],
      [false, false, true, false, false, false],
    ],
    [['max-md:hidden'], [true, true, false, false, false, false]],
    [['block', 'hidden!'], ALL],
    [['hidden!', 'block!'], ALL],
    [
      ['block', 'md:!hidden'],
      [false, false, true, true, true, true],
    ],
    [['hidden', 'md:block!'], BELOW_MD],
  ])('reports display hiding per point: %s', (classes, expected) => {
    expect(displayMarkers(classes).hiddenAt).toEqual(expected);
  });

  it.each([
    [[]],
    [['block']],
    [['md:block']],
    [['hover:block']],
    [['unhidden']],
    [['hidden', 'block!']],
    [['hidden', '!block']],
    [['md:hidden', 'block!']],
  ])('reports no hiding without a hidden winner: %s', (classes) => {
    expect(displayMarkers(classes).hiddenAt).toEqual(NONE);
  });
});
