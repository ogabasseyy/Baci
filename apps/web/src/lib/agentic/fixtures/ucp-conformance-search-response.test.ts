// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { searchResponse } from './ucp-conformance-search-response';

describe('UCP conformance search response', () => {
  it('maps the product row into a one-product search response', () => {
    const { product, response } = searchResponse();

    expect(response.products).toEqual([product]);
    expect(product.title).toBe('Kobo phone');
  });

  it('returns the same inputs on every call', () => {
    expect(searchResponse().response).toEqual(searchResponse().response);
  });
});
