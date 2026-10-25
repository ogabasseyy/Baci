import { OGABASSEY_DOMAIN } from '@/config/ogabassey';
import { asRoute } from '@/lib/routes';
import { generateSlug } from '@/lib/seo-utils';

export const OGABASSEY_BLOG_PRIMARY_STATIC_TENANT = OGABASSEY_DOMAIN;
export const OGABASSEY_BLOG_STATIC_TENANTS = [
  OGABASSEY_BLOG_PRIMARY_STATIC_TENANT,
  'ogabassey',
] as const;

export function isOgabasseyBlogStaticTenant(slug: string): boolean {
  return OGABASSEY_BLOG_STATIC_TENANTS.some(
    (staticTenantSlug) => staticTenantSlug === slug
  );
}

export function getBlogCategorySlug(category: string): string {
  return generateSlug(category);
}

const RESERVED_CLEAN_BLOG_CATEGORY_SLUGS = new Set(['product']);
const OGABASSEY_BLOG_CATEGORY_SLUG_ALIASES = new Map([
  ['review', 'reviews'],
  ['news', 'tech-news'],
]);

export function getCanonicalBlogCategorySlug(categorySlug: string): string {
  return categorySlug.toLowerCase();
}

export function getOgabasseyBlogCategoryAliasSlug(
  categorySlug: string
): string | null {
  return (
    OGABASSEY_BLOG_CATEGORY_SLUG_ALIASES.get(categorySlug.toLowerCase()) ?? null
  );
}

export function findOgabasseyBlogCategoryAliasLabel(
  categories: string[],
  rawCategoryOrSlug: string
): string | null {
  const aliasSlug = getOgabasseyBlogCategoryAliasSlug(
    generateSlug(rawCategoryOrSlug)
  );
  if (!aliasSlug) {
    return null;
  }

  return (
    categories
      .find((entry) => generateSlug(entry.trim()) === aliasSlug)
      ?.trim() ?? null
  );
}

export function canUseCleanBlogCategorySlug(categorySlug: string): boolean {
  return (
    Boolean(categorySlug) &&
    !RESERVED_CLEAN_BLOG_CATEGORY_SLUGS.has(categorySlug)
  );
}

function getDistinctCategoryLabels(categories: string[]): string[] {
  return [
    ...new Set(categories.map((category) => category.trim()).filter(Boolean)),
  ];
}

export function getCollidingBlogCategorySlugs(
  categories: string[]
): Set<string> {
  const labelsBySlug = new Map<string, Set<string>>();

  for (const category of getDistinctCategoryLabels(categories)) {
    const slug = getBlogCategorySlug(category);
    if (!slug) {
      continue;
    }
    const labels = labelsBySlug.get(slug) ?? new Set<string>();
    labels.add(category);
    labelsBySlug.set(slug, labels);
  }

  return new Set(
    Array.from(labelsBySlug.entries())
      .filter(([, labels]) => labels.size > 1)
      .map(([slug]) => slug)
  );
}

export function hasBlogCategorySlugCollision(
  categories: string[],
  categorySlug: string
): boolean {
  return getCollidingBlogCategorySlugs(categories).has(
    categorySlug.toLowerCase()
  );
}

export function buildBlogCategoryHref(
  basePath: string,
  category: string,
  categories: string[] = []
): string {
  const normalizedBasePath =
    basePath === '/' ? '' : basePath.replace(/\/+$/, '');
  const categorySlug = getBlogCategorySlug(category);

  if (
    !canUseCleanBlogCategorySlug(categorySlug) ||
    hasBlogCategorySlugCollision(categories, categorySlug)
  ) {
    const query = new URLSearchParams({ category: category.trim() });

    return asRoute(`${normalizedBasePath}/blog?${query.toString()}`);
  }

  return asRoute(`${normalizedBasePath}/blog/category/${categorySlug}`);
}

export function buildBlogCategorySchemaUrl(
  baseUrl: string,
  category: string
): string {
  const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const categorySlug = getBlogCategorySlug(category);
  const url = new URL(
    canUseCleanBlogCategorySlug(categorySlug)
      ? `blog/category/${categorySlug}`
      : 'blog',
    normalizedBaseUrl
  );
  if (!canUseCleanBlogCategorySlug(categorySlug)) {
    url.searchParams.set('category', category.trim());
  }

  return url.toString();
}

export function findBlogCategoryLabelBySlug(
  categories: string[],
  categorySlug: string
): string | null {
  const normalizedSlug = getCanonicalBlogCategorySlug(categorySlug);
  if (!canUseCleanBlogCategorySlug(normalizedSlug)) {
    return null;
  }
  if (hasBlogCategorySlugCollision(categories, normalizedSlug)) {
    return null;
  }

  return (
    getDistinctCategoryLabels(categories).find(
      (category) => getBlogCategorySlug(category) === normalizedSlug
    ) ?? null
  );
}
