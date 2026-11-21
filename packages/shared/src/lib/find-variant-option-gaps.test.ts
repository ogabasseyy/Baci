import { describe, expect, it } from 'vitest';
import { findVariantOptionGaps } from './find-variant-option-gaps';

describe('findVariantOptionGaps', () => {
  it('flags the version that leaves blank an option its siblings fill', () => {
    // The live PlayStation 5 Console shape: New consoles carry a
    // region, the Used console does not.
    expect(
      findVariantOptionGaps([
        { storage: '1TB', region: 'Europe' },
        { storage: '1TB', region: 'Japan' },
        { storage: '825GB' },
      ])
    ).toEqual([{ variantIndex: 2, missingAxes: ['region'] }]);
  });

  it('reports nothing when every version fills the same options', () => {
    expect(
      findVariantOptionGaps([
        { color: 'Black', storage: '128GB' },
        { color: 'Blue', storage: '256GB' },
      ])
    ).toEqual([]);
  });

  it('treats whitespace-only and empty values as blank', () => {
    expect(
      findVariantOptionGaps([
        { ram: '8GB', color: 'Black' },
        { ram: '   ', color: 'Blue' },
        { ram: null, color: 'Red' },
      ])
    ).toEqual([
      { variantIndex: 1, missingAxes: ['ram'] },
      { variantIndex: 2, missingAxes: ['ram'] },
    ]);
  });

  it('counts numbers and booleans as filled values', () => {
    expect(
      findVariantOptionGaps([
        { storage: 512, touchbar: true },
        { storage: 256, touchbar: false },
        { storage: Number.NaN, touchbar: true },
      ])
    ).toEqual([{ variantIndex: 2, missingAxes: ['storage'] }]);
  });

  it('matches option names regardless of spelling or casing', () => {
    expect(
      findVariantOptionGaps([{ Colour: 'Black' }, { color: 'Blue' }])
    ).toEqual([]);
  });

  it('ignores descriptive fields that are never a shopper choice', () => {
    expect(
      findVariantOptionGaps([
        { color: 'Black', notes: 'Boxed' },
        { color: 'Blue' },
      ])
    ).toEqual([]);
  });

  it('handles products with no versions or no options', () => {
    expect(findVariantOptionGaps([])).toEqual([]);
    expect(findVariantOptionGaps([{}, null, undefined])).toEqual([]);
  });
});
