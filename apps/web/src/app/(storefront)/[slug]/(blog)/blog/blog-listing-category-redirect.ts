import {
  buildBlogCategoryHref,
  findBlogCategoryLabelBySlug,
  findOgabasseyBlogCategoryAliasLabel,
  getBlogCategorySlug,
  isOgabasseyBlogStaticTenant,
} from './blog-category-routing';
import type { BlogSearchParamValue } from './blog-search-params';

const BLOG_CATEGORY_REDIRECT_FILTER_PARAMS = new Set([
  'category',
  'page',
  'search',
]);

export function findPublicCategoryLabel(
  category: string,
  publicCategories: string[],
  identifier?: string | null
): string | null;
export function findPublicCategoryLabel(
  publicCategories: string[],
  category: string,
  identifier?: string | null
): string | null;
export function findPublicCategoryLabel(
  first: string | string[],
  second: string | string[],
  identifier?: string | null
): string | null {
  let category: string;
  let publicCategories: string[];

  if (typeof first === 'string' && Array.isArray(second)) {
    category = first;
    publicCategories = second;
  } else if (Array.isArray(first) && typeof second === 'string') {
    category = second;
    publicCategories = first;
  } else {
    return null;
  }

  const trimmed = category.trim();
  const normalized = trimmed.toLowerCase();

  const exactMatch = publicCategories.find(
    (entry) => entry.trim().toLowerCase() === normalized
  );
  if (exactMatch) {
    return exactMatch.trim();
  }

  const slugMatch = findBlogCategoryLabelBySlug(
    publicCategories,
    getBlogCategorySlug(trimmed)
  );
  if (slugMatch) {
    return slugMatch.trim();
  }

  if (identifier && isOgabasseyBlogStaticTenant(identifier)) {
    return findOgabasseyBlogCategoryAliasLabel(publicCategories, trimmed);
  }

  return null;
}

export interface BuildBlogListingCategoryRedirectHrefOptions {
  basePath: string;
  category: string;
  page?: number | string | null;
  publicCategories: string[];
  identifier?: string | null;
}

export function buildBlogListingCategoryRedirectHref({
  basePath,
  category,
  page = 1,
  publicCategories,
  identifier,
}: BuildBlogListingCategoryRedirectHrefOptions): string | null {
  const parsedPage =
    typeof page === 'number'
      ? page
      : typeof page === 'string'
        ? Number.parseInt(page, 10)
        : 1;

  if (Number.isFinite(parsedPage) && parsedPage > 1) {
    return null;
  }

  const categoryLabel = findPublicCategoryLabel(
    category,
    publicCategories,
    identifier
  );
  if (!categoryLabel) {
    return null;
  }

  const categoryHref = buildBlogCategoryHref(
    basePath,
    categoryLabel,
    publicCategories
  );

  return categoryHref.includes('?') ? null : categoryHref;
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
