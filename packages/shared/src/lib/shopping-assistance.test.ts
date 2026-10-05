import { describe, expect, it } from 'vitest';
import {
  mergeAssistedRefinements,
  parseSearchAssistanceProposal,
  searchAssistanceQuerySchema,
} from './shopping-assistance';

describe('assisted search proposals', () => {
  it('accepts a bounded editable query and explicit filters including zero', () => {
    const proposal = parseSearchAssistanceProposal({
      query: 'iphone',
      explanation: 'Used phones within your budget.',
      filters: { brands: ['Apple'], condition: 'used', maxPrice: 0 },
    });
    expect(proposal.filters.maxPrice).toBe(0);
    expect(
      mergeAssistedRefinements(
        { brands: [], sort: 'price_asc', minRating: 4 },
        proposal
      )
    ).toEqual({
      brands: ['Apple'],
      sort: 'price_asc',
      minRating: 4,
      condition: 'used',
      maxPrice: 0,
    });
  });
  it('rejects extra actions, unsafe ranges and missing searchable terms', () => {
    expect(() =>
      parseSearchAssistanceProposal({
        query: 'iphone',
        explanation: 'ok',
        filters: {},
        action: 'checkout',
      })
    ).toThrow();
    expect(() =>
      parseSearchAssistanceProposal({
        query: '!!',
        explanation: 'ok',
        filters: {},
      })
    ).toThrow();
    expect(() =>
      parseSearchAssistanceProposal({
        query: 'iphone',
        explanation: 'ok',
        filters: { minPrice: 100, maxPrice: 50 },
      })
    ).toThrow();
  });
  it('requires confirmation before changing a contradictory existing budget', () => {
    const proposal = parseSearchAssistanceProposal({
      query: 'iphone',
      explanation: 'Budget',
      filters: { maxPrice: 50 },
    });
    expect(() =>
      mergeAssistedRefinements(
        { brands: [], sort: 'relevance', minPrice: 100 },
        proposal
      )
    ).toThrow('price range');
  });
  it('bounds the shared query rule at 2–120 trimmed chars plus a catalog term', () => {
    expect(searchAssistanceQuerySchema.safeParse('ab').success).toBe(true);
    expect(searchAssistanceQuerySchema.safeParse('a'.repeat(120)).success).toBe(
      true
    );
    expect(searchAssistanceQuerySchema.safeParse('a').success).toBe(false);
    expect(searchAssistanceQuerySchema.safeParse('a'.repeat(121)).success).toBe(
      false
    );
    expect(searchAssistanceQuerySchema.safeParse('!!').success).toBe(false);
    expect(searchAssistanceQuerySchema.safeParse('  ab  ').success).toBe(true);
  });
});
