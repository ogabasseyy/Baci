import { describe, expect, it } from 'vitest';
import { describeAssistedFilters } from './describe-assisted-filters';
import { parseSearchAssistanceProposal } from './parse-search-assistance-proposal';

describe('describe-assisted-filters', () => {
  it('labels brands, conditions, and price bounds while skipping unset filters', () => {
    const proposal = parseSearchAssistanceProposal({
      query: 'iphone',
      explanation: 'Used phones within your budget.',
      filters: {
        brands: ['Apple'],
        condition: 'open_box',
        minPrice: 100000,
        maxPrice: 500000,
      },
    });
    expect(describeAssistedFilters(proposal)).toEqual([
      'Apple',
      'Open box',
      `From ₦${(100000).toLocaleString('en-NG')}`,
      `Up to ₦${(500000).toLocaleString('en-NG')}`,
    ]);
    const bare = parseSearchAssistanceProposal({
      query: 'iphone',
      explanation: 'Anything goes.',
      filters: {},
    });
    expect(describeAssistedFilters(bare)).toEqual([]);
  });
});
