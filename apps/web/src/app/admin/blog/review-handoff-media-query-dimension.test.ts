import { describe, expect, it } from 'vitest';
import { evaluateDimensionAtom } from './review-handoff-media-query-dimension';

describe('evaluateDimensionAtom', () => {
  it.each([
    'max-width: -1px',
    'MAX-WIDTH: -1PX',
    'width: -0.5px',
    'width < 0px',
    'width <= -1px',
    '100px > width > 400px',
    '100px < width < 50px',
    '1in <= width <= 10px',
    '1in < width < 96px',
    'width = -5px',
  ])('proves %s never matches', (condition) => {
    expect(evaluateDimensionAtom(condition)).toBe('false');
  });

  it.each([
    'min-width: -1px',
    'MIN-WIDTH: 0px',
    'width >= -1px',
    'width >= 0px',
  ])('proves %s always matches', (condition) => {
    expect(evaluateDimensionAtom(condition)).toBe('true');
  });

  it.each([
    'min-width: 100px',
    'max-width: 100px',
    'width: 100px',
    'width > 100px',
    'width <= 0px',
    'width > 0px',
    '400px > width > 100px',
    '96px <= width <= 1in',
    '10px <= width <= 1in',
    '50vw <= width <= 100px',
    '10em <= width <= 5px',
    'width < calc(1px)',
    'orientation: landscape',
    'color: -1',
    'screen',
    '(min-width)',
    '(width >> 100px)',
    '',
  ])('leaves %s unevaluated', (condition) => {
    expect(evaluateDimensionAtom(condition)).toBe('other');
  });
});
