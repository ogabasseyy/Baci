import { describe, expect, it } from 'vitest';
import { imageSizeZeroAt } from './review-handoff-image-size';

// Six chars per expectation: base, sm, md, lg, xl, 2xl.
function flags(values: boolean[]): string {
  return values.map((value) => (value ? 'T' : 'F')).join('');
}

describe('imageSizeZeroAt', () => {
  it.each([
    ['zero class', ['h-0'], false, false, 'TTTTTT'],
    ['zero attribute', [], true, false, 'TTTTTT'],
    ['attribute restored', ['w-auto'], true, false, 'FFFFFF'],
    ['max does not restore', ['max-w-full'], true, false, 'TTTTTT'],
    ['min restores', ['min-w-full'], true, false, 'FFFFFF'],
    ['responsive restore', ['md:w-auto'], true, false, 'TTFFFF'],
    ['max caps class', ['max-h-0', 'h-screen'], false, false, 'TTTTTT'],
    ['sized image', ['h-64', 'w-64'], false, false, 'FFFFFF'],
  ])('%s: %s', (_name, classes, widthAttrZero, heightAttrZero, expected) => {
    expect(
      flags(
        imageSizeZeroAt(
          classes as string[],
          widthAttrZero as boolean,
          heightAttrZero as boolean
        )
      )
    ).toBe(expected);
  });
});
