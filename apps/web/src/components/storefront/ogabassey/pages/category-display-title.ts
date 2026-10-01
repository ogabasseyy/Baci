/** Human-readable category heading derived from the route slug. */
export function buildCategoryDisplayTitle(categoryName: string): string {
  if (categoryName === 'All') return 'All Products';

  return decodeURIComponent(categoryName)
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (l) => l.toUpperCase());
}
