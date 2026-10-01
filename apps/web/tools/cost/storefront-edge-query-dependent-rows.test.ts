import { describe, expect, it } from 'vitest';
import { STOREFRONT_EDGE_QUERY_DEPENDENT_ROWS } from './storefront-edge-query-dependent-rows';

describe('STOREFRONT_EDGE_QUERY_DEPENDENT_ROWS', () => {
  it('keeps every PDP query on the origin for product-specific variant axes', () => {
    // Arrange
    const productRows = STOREFRONT_EDGE_QUERY_DEPENDENT_ROWS.filter(({ id }) =>
      id.includes('product-category')
    );

    // Act and assert
    expect(productRows).toHaveLength(4);
    expect(
      productRows.every(
        ({ requestCondition }) =>
          requestCondition?.anyQueryPresent === true &&
          requestCondition.anyQueryKeyPresent === undefined
      )
    ).toBe(true);
  });

  it('keeps metadata-cache-only compare requests eligible for their release', () => {
    // Arrange
    const compareRow = STOREFRONT_EDGE_QUERY_DEPENDENT_ROWS.find(
      ({ id }) => id === 'request-override:query-dependent-compare-root'
    );

    // Act and assert
    expect(compareRow?.requestCondition).toEqual(
      expect.objectContaining({
        anyQueryPresent: true,
        anyQueryPresentExcept: ['__baci_metadata_cache_bucket'],
      })
    );
  });
});
