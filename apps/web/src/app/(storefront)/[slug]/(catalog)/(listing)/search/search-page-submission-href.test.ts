import { describe, expect, it } from 'vitest';
import { buildSearchSubmissionHref } from './search-page-submission-href';

const BASE_PATH = '/ogabassey/search';

describe('buildSearchSubmissionHref', () => {
  it('builds a page-less submission URL with an encoded query', () => {
    expect(buildSearchSubmissionHref(BASE_PATH, 'iphone 16')).toBe(
      '/ogabassey/search?q=iphone%2016'
    );
  });
});
