import {
  buildStorefrontPageHref,
  getStorefrontCrawlDiscoveryPages,
  STOREFRONT_CRAWL_DISCOVERY_PRODUCT_PAGE_LIMIT,
} from '@/lib/storefront-pagination';
import type {
  StorefrontLinkModule,
  StorefrontLinkModuleItem,
} from './link-module-types';
import {
  dedupeLinkModuleItems,
  pruneEmptyLinkModules,
} from './link-module-utils';

interface CategoryModuleInput {
  slug: string;
  name: string;
  totalPages: number;
}

interface LinkModuleInput {
  href: string;
  label: string;
}

interface BuildCatalogLinkModulesInput {
  productBasePath: string;
  productTotalPages: number;
  categories: CategoryModuleInput[];
  compareLinks: LinkModuleInput[];
  editorialLinks: LinkModuleInput[];
}

function buildPaginationItems(
  basePath: string,
  labelPrefix: string,
  totalPages: number
): StorefrontLinkModuleItem[] {
  return getStorefrontCrawlDiscoveryPages({
    totalPages,
    currentPage: 1,
    allPagesThreshold: STOREFRONT_CRAWL_DISCOVERY_PRODUCT_PAGE_LIMIT,
    maxPages: STOREFRONT_CRAWL_DISCOVERY_PRODUCT_PAGE_LIMIT,
  })
    .filter((page) => page > 1)
    .map((page) => ({
      href: buildStorefrontPageHref(basePath, page),
      label: `${labelPrefix} page ${page}`,
      source: 'catalog-pagination',
    }));
}

export function buildCatalogLinkModules({
  productBasePath,
  productTotalPages,
  categories,
  compareLinks,
  editorialLinks,
}: BuildCatalogLinkModulesInput): StorefrontLinkModule[] {
  const categoryItems: StorefrontLinkModuleItem[] = categories.map(
    (category) => ({
      href: `/${category.slug}`,
      label: category.name,
      source: 'category',
    })
  );
  const categoryPageItems = categories.flatMap((category) =>
    buildPaginationItems(
      `/${category.slug}`,
      category.name,
      category.totalPages
    )
  );

  return pruneEmptyLinkModules([
    {
      id: 'catalog-categories',
      title: 'Shop by category',
      description: 'Browse maintained Ogabassey category hubs.',
      items: dedupeLinkModuleItems(categoryItems),
    },
    {
      id: 'catalog-pages',
      title: 'Browse product pages',
      description: 'Jump through the maintained product index.',
      items: dedupeLinkModuleItems(
        buildPaginationItems(productBasePath, 'Products', productTotalPages)
      ),
    },
    {
      id: 'category-pages',
      title: 'Browse category pages',
      description: 'Jump to maintained category listing pages.',
      items: dedupeLinkModuleItems(categoryPageItems),
    },
    {
      id: 'compare-modules',
      title: 'Compare products',
      description:
        'Use maintained comparison pages for common buying decisions.',
      items: dedupeLinkModuleItems(
        compareLinks.map((link) => ({
          ...link,
          source: 'compare',
        }))
      ),
    },
    {
      id: 'editorial-guides',
      title: 'Buying guides',
      description: 'Read maintained guides that support product research.',
      items: dedupeLinkModuleItems(
        editorialLinks.map((link) => ({
          ...link,
          source: 'editorial',
        }))
      ),
    },
  ]);
}
