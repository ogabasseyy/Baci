import { describe, expect, it } from 'vitest';
import {
  BREAKPOINT_POINT_COUNT,
  breakpointWinnerAtPoint,
} from './review-handoff-breakpoints';

describe('breakpointWinnerAtPoint', () => {
  it('covers six evaluation points', () => {
    expect(BREAKPOINT_POINT_COUNT).toBe(6);
  });

  it('prefers higher min-width layers where they apply', () => {
    const winners = new Map([
      ['', 'base'],
      ['md:', 'medium'],
    ]);
    expect(breakpointWinnerAtPoint(winners, 0)).toBe('base');
    expect(breakpointWinnerAtPoint(winners, 1)).toBe('base');
    expect(breakpointWinnerAtPoint(winners, 2)).toBe('medium');
    expect(breakpointWinnerAtPoint(winners, 5)).toBe('medium');
  });

  it('applies max-* layers strictly below their threshold', () => {
    const winners = new Map([
      ['', 'base'],
      ['max-md:', 'narrow'],
    ]);
    expect(breakpointWinnerAtPoint(winners, 0)).toBe('narrow');
    expect(breakpointWinnerAtPoint(winners, 1)).toBe('narrow');
    expect(breakpointWinnerAtPoint(winners, 2)).toBe('base');
  });

  it('lets min-width layers beat overlapping max-* layers', () => {
    // max-md: and sm: overlap on point 1; sm: sorts later.
    const winners = new Map([
      ['max-md:', 'narrow'],
      ['sm:', 'small'],
    ]);
    expect(breakpointWinnerAtPoint(winners, 0)).toBe('narrow');
    expect(breakpointWinnerAtPoint(winners, 1)).toBe('small');
  });

  it('orders max-* layers widest first', () => {
    const winners = new Map([
      ['max-md:', 'medium'],
      ['max-sm:', 'small'],
    ]);
    expect(breakpointWinnerAtPoint(winners, 0)).toBe('small');
    expect(breakpointWinnerAtPoint(winners, 1)).toBe('medium');
  });

  it('returns undefined when nothing applies', () => {
    expect(breakpointWinnerAtPoint(new Map(), 0)).toBeUndefined();
    expect(
      breakpointWinnerAtPoint(new Map([['md:', 'medium']]), 0)
    ).toBeUndefined();
    expect(
      breakpointWinnerAtPoint(new Map([['hover:', 'hover']]), 3)
    ).toBeUndefined();
  });
});
