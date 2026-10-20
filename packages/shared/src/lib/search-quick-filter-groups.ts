import type { SearchRefinements } from './search-refinement-types';

/** Quick groups are backed by the complete query facets, never the loaded page. */
export function getSearchQuickFilterGroups(
  criteria: SearchRefinements,
  categories: { id: string; name: string }[],
  processors: string[] = []
) {
  return [
    { key: 'brand', label: 'Brand', active: criteria.brands.length > 0 },
    {
      key: 'price',
      label: 'Price',
      active:
        criteria.minPrice !== undefined || criteria.maxPrice !== undefined,
    },
    { key: 'condition', label: 'Condition', active: !!criteria.condition },
    ...(categories.length > 1 || criteria.categoryId
      ? [{ key: 'category', label: 'Type', active: !!criteria.categoryId }]
      : []),
    ...(processors.length || criteria.processor
      ? [{ key: 'processor', label: 'Processor', active: !!criteria.processor }]
      : []),
  ];
}
