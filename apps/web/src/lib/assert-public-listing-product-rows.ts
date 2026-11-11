import {
  type ListingRow,
  readPublicListingProductRows,
} from './read-public-listing-product-rows';

export type { ListingRow };

/** Validate and narrow an existing typed array without dropping its extra columns. */
export function assertPublicListingProductRows<T>(
  rows: T[]
): asserts rows is Array<T & ListingRow> {
  readPublicListingProductRows(rows);
}
