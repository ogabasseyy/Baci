import { describe, expect, it } from 'vitest';
import { normalizeSpecSections } from './normalize-spec-sections';

describe('normalizeSpecSections', () => {
  it('normalizes section names and drops sections without usable items', () => {
    expect(
      normalizeSpecSections([
        {
          category: ' Display ',
          items: [{ label: 'Resolution', value: '1080p' }],
        },
        { category: 'Empty', items: [] },
      ])
    ).toEqual([
      {
        category: 'Display',
        items: [{ label: 'Resolution', value: '1080p' }],
      },
    ]);
  });
});
