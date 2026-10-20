import { describe, expect, it } from 'vitest';
import { parseSearchAssistanceProposal } from './parse-search-assistance-proposal';

describe('parseSearchAssistanceProposal', () => {
  it('accepts a bounded editable query and explicit filters including zero', () => {
    const proposal = parseSearchAssistanceProposal({
      query: 'iphone',
      explanation: 'Used phones within your budget.',
      filters: { brands: ['Apple'], condition: 'used', maxPrice: 0 },
    });
    expect(proposal.query).toBe('iphone');
    expect(proposal.filters.maxPrice).toBe(0);
  });

  it('defaults a missing filters object to empty instead of rejecting', () => {
    const proposal = parseSearchAssistanceProposal({
      query: 'phone',
      explanation: 'Compare camera specifications across phones.',
    });
    expect(proposal.filters).toEqual({});
  });
});
