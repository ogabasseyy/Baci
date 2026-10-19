import { describe, expect, it } from 'vitest';
import { buildSearchHref } from './search-page-href';

const BASE_PATH = '/ogabassey/search';

describe('buildSearchHref', () => {
  it('marks navigational page-1 targets with an explicit page parameter', () => {
    expect(buildSearchHref(BASE_PATH, 'iphone', 1)).toBe(
      '/ogabassey/search?q=iphone&page=1'
    );
  });

  it('keeps deeper pages on the shared pagination builder', () => {
    expect(buildSearchHref(BASE_PATH, 'iphone', 3)).toBe(
      '/ogabassey/search?q=iphone&page=3'
    );
  });

  it('collapses a query-less page-1 target to the plain route', () => {
    expect(buildSearchHref(BASE_PATH, '', 1)).toBe('/ogabassey/search');
  });

  it('encodes special characters in navigational targets', () => {
    expect(buildSearchHref(BASE_PATH, 'a&b=c', 1)).toBe(
      '/ogabassey/search?q=a%26b%3Dc&page=1'
    );
  });
});
