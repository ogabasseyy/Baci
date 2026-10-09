import type { SearchRefinements } from './search-refinement-types';
export interface SearchRefinementChip {
  key: string;
  label: string;
  next: SearchRefinements;
}
export function getSearchRefinementChips(
  criteria: SearchRefinements,
  categories: { id: string; name: string }[],
  formatPrice: (price: number) => string = (price) => `₦${price}`
): SearchRefinementChip[] {
  // SQL and the checkbox UI treat brands as trimmed case-insensitive
  // facets, so chip identities dedupe the same way: one chip per
  // equivalent set, whose dismissal removes every equivalent spelling.
  const chips: SearchRefinementChip[] = [];
  const seenBrandIdentities = new Set<string>();
  for (const brand of criteria.brands) {
    const identity = brand.trim().toLowerCase();
    if (seenBrandIdentities.has(identity)) continue;
    seenBrandIdentities.add(identity);
    chips.push({
      key: `brand:${identity}`,
      label: brand.trim(),
      next: {
        ...criteria,
        brands: criteria.brands.filter(
          (value) => value.trim().toLowerCase() !== identity
        ),
      },
    });
  }
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
      label: `${formatPrice(criteria.minPrice ?? 0)} – ${criteria.maxPrice === undefined ? 'Any' : formatPrice(criteria.maxPrice)}`,
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
