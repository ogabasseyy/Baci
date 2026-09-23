import { isRawDbProductRecord } from '@/lib/raw-db-product';
import {
  buildCompareLinkGraph,
  COMPARE_GRAPH_INDEXABLE_CATEGORY_LINK_LIMIT,
} from '@/lib/storefront-link-modules/compare-link-graph';
import {
  buildCanonicalCompareCategories,
  type CompareIndexSection,
  normalizeCompareProduct,
  sortCompareSections,
  toRequestRelativeHref,
} from './compare-page-content-helpers';

export const COMPARE_INDEX_CATEGORY_DISCOVERY_LIMIT = 20;
export const COMPARE_INDEX_CATEGORY_SCAN_LIMIT = 80;
export const COMPARE_INDEX_DISCOVERY_CONCURRENCY = 3;
export const COMPARE_INDEX_PRODUCTS_PER_CATEGORY_LIMIT = 80;
export const COMPARE_INDEX_LINKS_PER_CATEGORY_LIMIT =
  COMPARE_GRAPH_INDEXABLE_CATEGORY_LINK_LIMIT;
export const COMPARE_INDEX_TOTAL_LINK_LIMIT = 800;

// Visible /compare hub only. The 800-link discovery cap is for sitemap/graph
// builders; putting that many Next links in the document was a 689KB HTML
// payload with ~4.8s LCP element-render delay in mobile PSI.
export const COMPARE_HUB_PAGE_CATEGORY_LIMIT = 8;
export const COMPARE_HUB_PAGE_LINKS_PER_CATEGORY_LIMIT = 4;
// Discovery window for the visible hub. Keep this aligned with sitemap/
// metadata scans so a category whose first few products lack key specs can
// still surface later pairs. Emitted HTML stays capped by the link limits.
export const COMPARE_HUB_PAGE_PRODUCTS_PER_CATEGORY_LIMIT =
  COMPARE_INDEX_PRODUCTS_PER_CATEGORY_LIMIT;
export const COMPARE_HUB_PAGE_TOTAL_LINK_LIMIT = 24;

interface CompareIndexCategory {
  is_active?: boolean | null;
  name?: string | null;
  slug: string | null;
}

interface CompareIndexCategoryPageData {
  fallbackName?: string | null;
  isCollection?: boolean;
  isInactiveCategory?: boolean;
  products?: unknown[] | null;
}

interface BuildCompareIndexSectionsInput {
  categories: CompareIndexCategory[];
  categoryLimit?: number;
  categoryScanLimit?: number;
  concurrency?: number;
  getCategoryPageData: (
    categorySlug: string,
    productOffset: number,
    productLimit: number
  ) => Promise<CompareIndexCategoryPageData | null | undefined>;
  linksPerCategoryLimit?: number;
  pathPrefix?: string;
  productLimit?: number;
  storeUrl: string;
  totalLinkLimit?: number;
}

function capCompareIndexSections(
  sections: CompareIndexSection[],
  totalLinkLimit: number
) {
  const cappedSections: CompareIndexSection[] = [];
  let remainingLinks = Math.max(0, totalLinkLimit);

  for (const section of sections) {
    if (remainingLinks === 0) {
      break;
    }

    const links = section.links.slice(0, remainingLinks);

    if (links.length > 0) {
      cappedSections.push({
        ...section,
        links,
      });
      remainingLinks -= links.length;
    }
  }

  return cappedSections;
}

async function buildCompareIndexSection(input: {
  category: ReturnType<typeof buildCanonicalCompareCategories>[number];
  getCategoryPageData: BuildCompareIndexSectionsInput['getCategoryPageData'];
  linksPerCategoryLimit: number;
  pathPrefix: string;
  productLimit: number;
  storeUrl: string;
}) {
  const { category } = input;
  const { categorySlug } = category;
  let categoryData: CompareIndexCategoryPageData | null | undefined;

  try {
    categoryData = await input.getCategoryPageData(
      categorySlug,
      0,
      input.productLimit
    );
  } catch {
    return null;
  }

  if (
    !categoryData ||
    categoryData.isCollection ||
    categoryData.isInactiveCategory
  ) {
    return null;
  }

  const products = (categoryData.products ?? [])
    .filter(isRawDbProductRecord)
    .slice(0, input.productLimit)
    .map((product) => normalizeCompareProduct(product, categorySlug));
  const categoryName =
    categoryData.fallbackName || category.name || categorySlug;
  const links = buildCompareLinkGraph({
    storeUrl: input.storeUrl,
    categorySlug,
    categoryName,
    products,
    productsAreKnownActive: true,
    maxLinks: input.linksPerCategoryLimit,
  }).map((link) => ({
    href: toRequestRelativeHref(link.href, input.storeUrl, input.pathPrefix),
    label: link.label,
  }));

  if (links.length === 0) {
    return null;
  }

  return {
    categoryName,
    categorySlug,
    links,
  } satisfies CompareIndexSection;
}

export async function buildCompareIndexSections({
  categories,
  categoryLimit = COMPARE_INDEX_CATEGORY_DISCOVERY_LIMIT,
  categoryScanLimit = COMPARE_INDEX_CATEGORY_SCAN_LIMIT,
  concurrency = COMPARE_INDEX_DISCOVERY_CONCURRENCY,
  getCategoryPageData,
  linksPerCategoryLimit = COMPARE_INDEX_LINKS_PER_CATEGORY_LIMIT,
  pathPrefix = '',
  productLimit = COMPARE_INDEX_PRODUCTS_PER_CATEGORY_LIMIT,
  storeUrl,
  totalLinkLimit = COMPARE_INDEX_TOTAL_LINK_LIMIT,
}: BuildCompareIndexSectionsInput) {
  const canonicalCategories = buildCanonicalCompareCategories(categories)
    .filter((category) => category.is_active !== false)
    .slice(0, Math.max(0, categoryScanLimit));
  const sectionInput = {
    getCategoryPageData,
    linksPerCategoryLimit,
    pathPrefix,
    productLimit,
    storeUrl,
  };
  const populatedSections: CompareIndexSection[] = [];
  const batchSize = Math.min(
    Math.max(1, concurrency),
    canonicalCategories.length
  );

  for (let index = 0; index < canonicalCategories.length; index += batchSize) {
    const batch = canonicalCategories.slice(index, index + batchSize);
    const batchSections = await Promise.all(
      batch.map((category) =>
        buildCompareIndexSection({
          ...sectionInput,
          category,
        })
      )
    );

    populatedSections.push(
      ...batchSections.filter(
        (section): section is CompareIndexSection => section !== null
      )
    );
  }

  return capCompareIndexSections(
    populatedSections.sort(sortCompareSections).slice(0, categoryLimit),
    totalLinkLimit
  );
}
