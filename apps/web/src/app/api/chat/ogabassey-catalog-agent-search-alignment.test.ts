import { describe, expect, it } from 'vitest';
import { hasAlignedSearchForEmptyResult } from './ogabassey-catalog-agent-search-alignment';

describe('ogabassey-catalog-agent-search-alignment', () => {
  it('rejects empty claims from unrelated searches while allowing matching model or category queries', () => {
    expect(
      hasAlignedSearchForEmptyResult(
        [{ role: 'user', content: 'Do you carry Fairphone 5?' }],
        [{ query: 'iPhone' }]
      )
    ).toBe(false);

    expect(
      hasAlignedSearchForEmptyResult(
        [{ role: 'user', content: 'Do you carry Fairphone 5?' }],
        [{ query: 'Fairphone 5' }]
      )
    ).toBe(true);

    expect(
      hasAlignedSearchForEmptyResult(
        [{ role: 'user', content: 'I need a laptop below 2m' }],
        [{ query: 'MacBook' }]
      )
    ).toBe(true);

    expect(
      hasAlignedSearchForEmptyResult(
        [{ role: 'user', content: 'I need a laptop below 2m' }],
        [{ query: 'iPhone' }]
      )
    ).toBe(false);
    expect(
      hasAlignedSearchForEmptyResult(
        [{ role: 'user', content: 'Do you carry iPhone 16?' }],
        [{ query: 'iPhone 15' }]
      )
    ).toBe(false);
    expect(
      hasAlignedSearchForEmptyResult(
        [{ role: 'user', content: 'Do you carry iPhone 16?' }],
        [{ query: 'iPhone 16' }]
      )
    ).toBe(true);
  });
});
