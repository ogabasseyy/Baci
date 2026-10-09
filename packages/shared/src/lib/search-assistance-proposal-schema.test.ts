import { describe, expect, it } from 'vitest';
import { searchAssistanceProposalSchema } from './search-assistance-proposal-schema';

describe('searchAssistanceProposalSchema', () => {
  it('defaults a missing filters object to empty instead of rejecting', () => {
    // A compliant provider omits filters for subjective asks ("good
    // camera") rather than inventing one; the proposal must still
    // parse so the shopper gets the query suggestion.
    const proposal = searchAssistanceProposalSchema.parse({
      query: 'phone',
      explanation: 'Compare camera specifications across phones.',
    });
    expect(proposal.filters).toEqual({});
  });

  it('rejects extra actions, unsafe ranges and missing searchable terms', () => {
    expect(() =>
      searchAssistanceProposalSchema.parse({
        query: 'iphone',
        explanation: 'ok',
        filters: {},
        action: 'checkout',
      })
    ).toThrow();
    expect(() =>
      searchAssistanceProposalSchema.parse({
        query: '!!',
        explanation: 'ok',
        filters: {},
      })
    ).toThrow();
    expect(() =>
      searchAssistanceProposalSchema.parse({
        query: 'iphone',
        explanation: 'ok',
        filters: { minPrice: 100, maxPrice: 50 },
      })
    ).toThrow();
  });
});
