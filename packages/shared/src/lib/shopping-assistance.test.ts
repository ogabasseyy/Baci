import { describe, expect, it } from 'vitest';
import {
  mergeAssistedRefinements,
  parseSearchAssistanceProposal,
  searchAssistanceProposalSchema,
  searchAssistanceQuerySchema,
} from './shopping-assistance';

describe('shopping-assistance barrel', () => {
  it('re-exports the assistance schemas, parser, and merger', () => {
    expect(typeof searchAssistanceQuerySchema.parse).toBe('function');
    expect(typeof searchAssistanceProposalSchema.parse).toBe('function');
    const proposal = parseSearchAssistanceProposal({
      query: 'iphone',
      explanation: 'Used phones within your budget.',
      filters: { brands: ['Apple'] },
    });
    expect(
      mergeAssistedRefinements(
        { brands: [], sort: 'relevance' },
        proposal,
        'iphone'
      )
    ).toEqual({ brands: ['Apple'], sort: 'relevance' });
  });
});
