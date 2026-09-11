/** Storefront analytics carries product IDs, which are feed item_group_id values. */
export function facebookCatalogEvent<T extends object>(params: T) {
  return 'content_ids' in params && Array.isArray(params.content_ids)
    ? { ...params, content_type: 'product_group' as const }
    : params;
}
