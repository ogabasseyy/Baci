import type { SearchRefinements } from './search-refinements';
export interface SearchRefinementChip {
  key: string;
  label: string;
  next: SearchRefinements;
}
export function getSearchRefinementChips(
  criteria: SearchRefinements,
  categories: { id: string; name: string }[]
): SearchRefinementChip[] {
  const chips: SearchRefinementChip[] = criteria.brands.map((brand) => ({
    key: `brand:${brand}`,
    label: brand.trim(),
    next: {
      ...criteria,
      brands: criteria.brands.filter((value) => value !== brand),
    },
  }));
  if (criteria.categoryId)
    chips.push({
      key: 'category',
      label:
        categories.find((category) => category.id === criteria.categoryId)
          ?.name ?? 'Selected category',
      next: { ...criteria, categoryId: undefined },
    });
  if (criteria.processor)
    chips.push({
      key: 'processor',
      label: criteria.processor,
      next: { ...criteria, processor: undefined },
    });
  if (criteria.condition)
    chips.push({
      key: 'condition',
      label:
        criteria.condition === 'open_box'
          ? 'Open Box'
          : criteria.condition === 'used'
            ? 'Used'
            : 'New',
      next: { ...criteria, condition: undefined },
    });
  if (criteria.minPrice !== undefined || criteria.maxPrice !== undefined)
    chips.push({
      key: 'price',
      label: `₦${criteria.minPrice ?? 0} – ${criteria.maxPrice === undefined ? 'Any' : `₦${criteria.maxPrice}`}`,
      next: { ...criteria, minPrice: undefined, maxPrice: undefined },
    });
  if (criteria.minRating)
    chips.push({
      key: 'rating',
      label: `${criteria.minRating}+ stars`,
      next: { ...criteria, minRating: undefined },
    });
  return chips;
}

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
