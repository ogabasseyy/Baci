import { describe, expect, it } from 'vitest';
import { collapsesBoxToZero } from './review-handoff-scale-collapse';

describe('collapsesBoxToZero', () => {
  it.each([
    'scale(0)',
    'scale(0%)',
    'scale(1, 0)',
    'scalex(0)',
    'scaley(0)',
    'scale3d(0, 1, 1)',
    'matrix(0, 0, 1, 1, 0, 0)',
    'matrix(1, 1, 0, 0, 0, 0)',
    'matrix3d(0,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1)',
    'rotate(45deg) scale(0)',
  ])('detects a zero-area transform list: %s', (value) => {
    expect(collapsesBoxToZero(value, 'transform-list')).toBe(true);
  });

  it.each([
    'scale(1)',
    'scale(1, 1)',
    'scalex(1)',
    'scale3d(1, 1, 0)',
    'matrix(1, 0, 0, 1, 0, 0)',
    // Percentages are invalid in matrix(): an ignored declaration,
    // not hiding.
    'matrix(0%, 0, 1, 1, 0, 0)',
    'matrix3d(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1)',
    'rotate(45deg)',
    'scale(none)',
  ])('leaves a visible transform list alone: %s', (value) => {
    expect(collapsesBoxToZero(value, 'transform-list')).toBe(false);
  });

  it.each([
    '0',
    '0%',
    '0 1',
    '1 0',
    '0 1 1',
  ])('detects a zero-area scale property: %s', (value) => {
    expect(collapsesBoxToZero(value, 'scale-property')).toBe(true);
  });

  it.each([
    '1',
    '1 1',
    '1 1 1',
    '',
    '1 2 3 4',
    'none',
  ])('leaves a visible scale property alone: %s', (value) => {
    expect(collapsesBoxToZero(value, 'scale-property')).toBe(false);
  });

  it('resets the transform matcher between calls', () => {
    expect(
      collapsesBoxToZero('translate(1px) scale(0)', 'transform-list')
    ).toBe(true);
    expect(
      collapsesBoxToZero('translate(1px) scale(0)', 'transform-list')
    ).toBe(true);
  });
});
