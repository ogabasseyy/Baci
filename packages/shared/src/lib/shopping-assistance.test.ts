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
        proposal,
        'iphone'
      )
    ).toEqual({
      brands: ['Apple'],
      sort: 'price_asc',
      minRating: 4,
      condition: 'used',
      maxPrice: 0,
    });
  });
  it('defaults a missing filters object to empty instead of rejecting', () => {
    // A compliant provider omits filters for subjective asks ("good
    // camera") rather than inventing one; the proposal must still
    // parse so the shopper gets the query suggestion.
    const proposal = parseSearchAssistanceProposal({
      query: 'phone',
      explanation: 'Compare camera specifications across phones.',
    });
    expect(proposal.filters).toEqual({});
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
        proposal,
        'iphone'
      )
    ).toThrow('price range');
  });
  it('drops stale constraints when the proposal answers a different query', () => {
    const proposal = parseSearchAssistanceProposal({
      query: 'gaming laptop',
      explanation: 'Laptops for gaming.',
      filters: { brands: ['Lenovo'] },
    });
    // Apple/category/processor/rating/sort from the phone search cannot
    // carry into a laptop proposal the filters cannot express.
    expect(
      mergeAssistedRefinements(
        {
          brands: ['Apple'],
          categoryId: 'phones',
          processor: 'A17',
          sort: 'price_asc',
          minRating: 4,
        },
        proposal,
        'iphone'
      )
    ).toEqual({ brands: ['Lenovo'], sort: 'relevance' });
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
