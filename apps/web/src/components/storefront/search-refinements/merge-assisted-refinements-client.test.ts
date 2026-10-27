import {
  criteriaSchema,
  mergeAssistedRefinements,
  SEARCH_SORT_OPTIONS,
  type SearchAssistanceProposal,
  type SearchRefinements,
} from '@baci/shared/lib';
import { describe, expect, it } from 'vitest';
import { mergeAssistedRefinementsClient } from './merge-assisted-refinements-client';

const BASE_REFINEMENTS: SearchRefinements = {
  brands: ['Apple'],
  sort: 'relevance',
  categoryId: '123e4567-e89b-12d3-a456-426614174000',
  condition: 'used',
  processor: 'M1 Pro',
  minPrice: 500,
  maxPrice: 1500,
  minRating: 4,
};

const VALID_CASES: Array<{
  name: string;
  current: SearchRefinements;
  proposal: SearchAssistanceProposal;
  committedQuery: string;
}> = [
  {
    name: 'empty refinements and empty proposal',
    current: { brands: [], sort: 'relevance' },
    proposal: { query: 'phone', explanation: 'All phones', filters: {} },
    committedQuery: 'phone',
  },
  {
    name: 'preserves existing refinements when proposal matches committed query',
    current: BASE_REFINEMENTS,
    proposal: { query: 'laptop', explanation: 'Same search', filters: {} },
    committedQuery: 'laptop',
  },
  {
    name: 'resets existing refinements when proposal query differs from committed query',
    current: BASE_REFINEMENTS,
    proposal: {
      query: 'tablet',
      explanation: 'New search',
      filters: { minPrice: 300 },
    },
    committedQuery: 'laptop',
  },
  {
    name: 'deduplicates and sorts brands from proposal',
    current: { brands: ['Samsung'], sort: 'relevance' },
    proposal: {
      query: 'phone',
      explanation: 'Filtered',
      filters: { brands: ['Google', 'Apple', 'Google'] },
    },
    committedQuery: 'phone',
  },
  {
    name: 'applies valid sort, condition, and 2-decimal price bounds',
    current: { brands: [], sort: 'price_desc', minRating: 4.5 },
    proposal: {
      query: 'phone',
      explanation: 'Open box budget',
      filters: { condition: 'open_box', minPrice: 99.99, maxPrice: 499.5 },
    },
    committedQuery: 'phone',
  },
  {
    name: 'supports nil UUID category and trims processor whitespace',
    current: {
      brands: [],
      sort: 'relevance',
      categoryId: '00000000-0000-0000-0000-000000000000',
      processor: '  Snapdragon 8 Gen 2  ',
    },
    proposal: {
      query: 'phone',
      explanation: 'Exact price',
      filters: { minPrice: 200, maxPrice: 200 },
    },
    committedQuery: 'phone',
  },
  {
    name: 'treats falsy condition, processor, and category as absent',
    current: {
      brands: [],
      sort: 'relevance',
      condition: false as unknown as SearchRefinements['condition'],
      processor: 0 as unknown as string,
      categoryId: false as unknown as string,
    },
    proposal: { query: 'phone', explanation: 'Falsy fields', filters: {} },
    committedQuery: 'phone',
  },
];

const INVALID_CASES: Array<{
  name: string;
  current: SearchRefinements;
  proposal: SearchAssistanceProposal;
  committedQuery: string;
}> = [
  {
    name: 'conflicting price bounds: minPrice > maxPrice',
    current: { brands: [], sort: 'relevance' },
    proposal: {
      query: 'phone',
      explanation: 'Conflicting',
      filters: {
        minPrice: 500,
        maxPrice: 100,
      } as unknown as SearchAssistanceProposal['filters'],
    },
    committedQuery: 'phone',
  },
  {
    name: 'invalid sort option in current',
    current: {
      brands: [],
      sort: 'unsupported_sort' as unknown as SearchRefinements['sort'],
    },
    proposal: { query: 'phone', explanation: 'Invalid sort', filters: {} },
    committedQuery: 'phone',
  },
  {
    name: 'whitespace-only brand in proposal',
    current: { brands: [], sort: 'relevance' },
    proposal: {
      query: 'phone',
      explanation: 'Whitespace brand',
      filters: {
        brands: ['   '],
      } as unknown as SearchAssistanceProposal['filters'],
    },
    committedQuery: 'phone',
  },
  {
    name: 'brand exceeding 160 characters',
    current: { brands: [], sort: 'relevance' },
    proposal: {
      query: 'phone',
      explanation: 'Long brand',
      filters: {
        brands: ['A'.repeat(161)],
      } as unknown as SearchAssistanceProposal['filters'],
    },
    committedQuery: 'phone',
  },
  {
    name: 'invalid category UUID format',
    current: { brands: [], sort: 'relevance', categoryId: 'not-a-valid-uuid' },
    proposal: { query: 'phone', explanation: 'Bad UUID', filters: {} },
    committedQuery: 'phone',
  },
  {
    name: 'invalid condition',
    current: {
      brands: [],
      sort: 'relevance',
      condition: 'refurbished' as unknown as SearchRefinements['condition'],
    },
    proposal: { query: 'phone', explanation: 'Bad condition', filters: {} },
    committedQuery: 'phone',
  },
  {
    name: 'processor exceeding 80 characters',
    current: {
      brands: [],
      sort: 'relevance',
      processor: 'Intel Core '.repeat(10),
    },
    proposal: { query: 'phone', explanation: 'Long processor', filters: {} },
    committedQuery: 'phone',
  },
  {
    name: 'minPrice with more than 2 decimal places',
    current: {
      brands: [],
      sort: 'relevance',
      minPrice: 10.999 as unknown as number,
    },
    proposal: { query: 'phone', explanation: 'Bad decimal price', filters: {} },
    committedQuery: 'phone',
  },
  {
    name: 'minRating exceeding 5 or negative minPrice',
    current: { brands: [], sort: 'relevance', minRating: 6, minPrice: -10 },
    proposal: { query: 'phone', explanation: 'Rating too high', filters: {} },
    committedQuery: 'phone',
  },
  {
    name: 'non-numeric minPrice type',
    current: {
      brands: [],
      sort: 'relevance',
      minPrice: true as unknown as number,
    },
    proposal: { query: 'phone', explanation: 'Bad price type', filters: {} },
    committedQuery: 'phone',
  },
  {
    name: 'invalid sort and invalid brand (sort error wins)',
    current: {
      brands: [],
      sort: 'bogus' as unknown as SearchRefinements['sort'],
    },
    proposal: {
      query: 'phone',
      explanation: 'Both invalid',
      filters: { brands: ['   '] },
    },
    committedQuery: 'phone',
  },
];

describe('mergeAssistedRefinementsClient parity with mergeAssistedRefinements', () => {
  it.each(VALID_CASES)('produces matching output for valid case: $name', ({
    current,
    proposal,
    committedQuery,
  }) => {
    expect(
      mergeAssistedRefinementsClient(current, proposal, committedQuery)
    ).toEqual(mergeAssistedRefinements(current, proposal, committedQuery));
  });

  it.each(INVALID_CASES)('throws matching error for invalid case: $name', ({
    current,
    proposal,
    committedQuery,
  }) => {
    let sharedError: Error | null = null;
    let clientError: Error | null = null;
    try {
      mergeAssistedRefinements(current, proposal, committedQuery);
    } catch (error) {
      sharedError = error as Error;
    }
    try {
      mergeAssistedRefinementsClient(current, proposal, committedQuery);
    } catch (error) {
      clientError = error as Error;
    }
    expect(clientError).not.toBeNull();
    expect(sharedError).not.toBeNull();
    expect(clientError?.message).toBe(sharedError?.message);
  });

  it('mirrors criteriaSchema keys and enum options via schema introspection', () => {
    const schemaShape = (
      criteriaSchema as unknown as { shape: Record<string, unknown> }
    ).shape;
    expect(Object.keys(schemaShape).sort()).toEqual([
      'brands',
      'categoryId',
      'condition',
      'maxPrice',
      'minPrice',
      'minRating',
      'processor',
      'sort',
    ]);

    const conditionField = schemaShape.condition as {
      unwrap?: () => { options?: readonly string[] };
      _def?: { innerType?: { options?: readonly string[] } };
    };
    const conditionOptions = conditionField.unwrap
      ? conditionField.unwrap().options
      : conditionField._def?.innerType?.options;
    expect([...(conditionOptions ?? [])].sort()).toEqual([
      'new',
      'open_box',
      'used',
    ]);

    const sortField = schemaShape.sort as { options?: readonly string[] };
    expect([...(sortField.options ?? [])].sort()).toEqual(
      SEARCH_SORT_OPTIONS.map((o) => o.value).sort()
    );
  });
});
