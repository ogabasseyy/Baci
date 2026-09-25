import type { JumiaProductMappingState } from './publish-products-data-loader';

/**
 * Reports whether a product create feed would be rejected as already
 * mapped. Product creation is a top-level feed: the server rejects a
 * create retry when ANY non-error mapping exists in the
 * product/shop/marketplace scope, so a partially mapped product must not
 * be offered another create (it can only fail with 409
 * `jumia_mapping_exists`). Rejected variants recover through the listing
 * update flow instead.
 *
 * The caller scopes `mappings` to the product id within the dialog's
 * integration, matching the server's guard exactly.
 */
export function isJumiaProductFullyMapped(
  mappings: readonly JumiaProductMappingState[] | undefined
): boolean {
  if (!mappings || mappings.length === 0) {
    return false;
  }
  return mappings.some((mapping) => mapping.syncStatus !== 'error');
}
