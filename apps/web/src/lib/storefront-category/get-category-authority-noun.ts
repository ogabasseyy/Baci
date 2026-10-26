export interface CategoryAuthorityNoun {
  titleNoun: string;
  lowerNoun: string;
}

const CATEGORY_AUTHORITY_NOUNS: Record<string, CategoryAuthorityNoun> = {
  smartphones: { titleNoun: 'Phones', lowerNoun: 'phones' },
  laptops: { titleNoun: 'Laptops', lowerNoun: 'laptops' },
  tablets: { titleNoun: 'Tablets', lowerNoun: 'tablets' },
  smartwatches: { titleNoun: 'Smartwatches', lowerNoun: 'smartwatches' },
};

export function getCategoryAuthorityNoun(
  categorySlug: string,
  categoryName?: string
): CategoryAuthorityNoun {
  const normalizedSlug = categorySlug.trim().toLowerCase();
  const matched = CATEGORY_AUTHORITY_NOUNS[normalizedSlug];
  if (matched) {
    return matched;
  }
  const fallback = categoryName?.trim() || categorySlug.trim();
  return {
    titleNoun: fallback,
    lowerNoun: fallback.toLowerCase(),
  };
}
