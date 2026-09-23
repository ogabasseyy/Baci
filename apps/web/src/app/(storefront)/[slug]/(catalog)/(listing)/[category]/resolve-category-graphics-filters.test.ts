import { describe, expect, it } from 'vitest';
import { resolveCategoryGraphicsFilters } from './resolve-category-graphics-filters';

const AVAILABLE_GRAPHICS = [
  'Integrated Graphics',
  'NVIDIA RTX 4070',
  'NVIDIA RTX 5080',
];

describe('resolveCategoryGraphicsFilters', () => {
  it('keeps distinct requested values that exist in the full-category facets', () => {
    expect(
      resolveCategoryGraphicsFilters(
        [' NVIDIA RTX 4070 ', 'NVIDIA RTX 4070', 'Integrated Graphics'],
        AVAILABLE_GRAPHICS
      )
    ).toEqual(['Integrated Graphics', 'NVIDIA RTX 4070']);
  });

  it('rejects unknown and overlong values before they reach cached queries', () => {
    expect(
      resolveCategoryGraphicsFilters(
        ['Unknown GPU', 'x'.repeat(121)],
        AVAILABLE_GRAPHICS
      )
    ).toEqual([]);
  });

  it('returns no selection when the facet read is unavailable', () => {
    expect(resolveCategoryGraphicsFilters('NVIDIA RTX 4070', [])).toEqual([]);
  });

  it('caps untrusted requests at eight values', () => {
    const available = Array.from({ length: 10 }, (_, i) => `GPU ${i}`);
    expect(resolveCategoryGraphicsFilters(available, available)).toHaveLength(
      8
    );
  });

  it('lifts the cap for trusted hub sources while keeping the allowlist', () => {
    const available = Array.from({ length: 10 }, (_, i) => `GPU ${i}`);
    expect(
      resolveCategoryGraphicsFilters([...available, 'Unknown GPU'], available, {
        trustedSource: true,
      })
    ).toEqual([...available].sort());
  });
});
