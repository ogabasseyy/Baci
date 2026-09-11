import {
  findBlogCategoryLabelBySlug,
  getBlogCategorySlug,
} from './blog-category-routing';
import type { BlogSearchParamValue } from './blog-search-params';

const BLOG_CATEGORY_REDIRECT_FILTER_PARAMS = new Set([
  'category',
  'page',
  'search',
]);

export function findPublicCategoryLabel(
  publicCategories: string[],
  category: string
): string | null {
  const trimmedCategory = category.trim();
  const normalizedCategory = trimmedCategory.toLowerCase();

  return (
    publicCategories.find(
      (publicCategory) =>
        publicCategory.trim().toLowerCase() === normalizedCategory
    ) ??
    findBlogCategoryLabelBySlug(
      publicCategories,
      getBlogCategorySlug(trimmedCategory)
    )
  );
}

export function appendPreservedBlogCategoryRedirectParams(
  href: string,
  searchParamValues: Record<string, BlogSearchParamValue>
): string {
  const preservedParams = new URLSearchParams();

  for (const [key, value] of Object.entries(searchParamValues)) {
    if (BLOG_CATEGORY_REDIRECT_FILTER_PARAMS.has(key)) {
      continue;
    }

    const values = Array.isArray(value) ? value : [value];
    for (const paramValue of values) {
      if (paramValue === undefined) {
        continue;
      }
      preservedParams.append(key, paramValue);
    }
  }

  const queryString = preservedParams.toString();
  if (!queryString) {
    return href;
  }

  return `${href}${href.includes('?') ? '&' : '?'}${queryString}`;
}
