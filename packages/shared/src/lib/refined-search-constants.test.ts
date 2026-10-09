import { describe, expect, it } from 'vitest';
import { REFINED_SEARCH_MAX_OFFSET } from './refined-search-constants';

describe('refined-search-constants', () => {
  it('pins the maximum offset to 100 pages at the 20-row page size', () => {
    expect(REFINED_SEARCH_MAX_OFFSET).toBe(1980);
  });
});
