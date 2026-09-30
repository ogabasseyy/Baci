import { describe, expect, it } from 'vitest';
import { searchSubmissionSchema } from './search-submission';

describe('search submission validation', () => {
  it('removes search punctuation and trims outer whitespace while preserving query spacing', () => {
    expect(
      searchSubmissionSchema.parse({
        query: '  phone;  case  ',
        pathPrefix: '/ogabassey',
        source: 'navbar',
      })
    ).toEqual({
      query: 'phone  case',
      pathPrefix: '/ogabassey',
      source: 'navbar',
    });
  });

  it.each([
    '',
    '  ',
    ';',
    'x'.repeat(101),
  ])('rejects an empty or oversized effective query: %j', (query) => {
    expect(
      searchSubmissionSchema.safeParse({
        query,
        pathPrefix: '',
        source: 'results-form',
      }).success
    ).toBe(false);
  });

  it.each([
    '//evil.test',
    '/store/search',
    '/store?q=other',
    '/store#other',
  ])('rejects navigation-shaped path prefixes: %s', (pathPrefix) => {
    expect(
      searchSubmissionSchema.safeParse({
        query: 'phone',
        pathPrefix,
        source: 'navbar',
      }).success
    ).toBe(false);
  });

  it('rejects forged merchant identity and result count fields', () => {
    expect(
      searchSubmissionSchema.safeParse({
        query: 'phone',
        pathPrefix: '',
        source: 'navbar',
        merchantId: 'other-tenant',
        resultsCount: 999,
      }).success
    ).toBe(false);
  });
});
