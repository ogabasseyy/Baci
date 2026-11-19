import type { getCachedCategories } from '@/lib/cached-data';
import { buildCatalogLinkModules } from '@/lib/storefront-link-modules/build-catalog-link-modules';
import { buildCompareLinkGraph } from '@/lib/storefront-link-modules/compare-link-graph';
import type { StorefrontLinkModule } from '@/lib/storefront-link-modules/link-module-types';
import { loadSemanticInventorySafely } from '@/lib/storefront-product/load-semantic-inventory-safely';

export const PRODUCTS_PAGE_COMPARE_MODULE_CATEGORY_LIMIT = 8;

export type ProductsPageLinkModuleCategory = Awaited<
  ReturnType<typeof getCachedCategories>
>[number] & {
  canonicalSlug: string;
  product_count?: number | null;
  productCount?: number | null;
};

async function loadCategoryCompareInputs(input: {
  categories: ProductsPageLinkModuleCategory[];
  merchantId: string;
}) {
  const compareCategories = input.categories.slice(
    0,
    PRODUCTS_PAGE_COMPARE_MODULE_CATEGORY_LIMIT
  );

  return await Promise.all(
    compareCategories.map(async (category) => {
      return {
        slug: category.slug,
        name: category.name,
        products: await loadSemanticInventorySafely({
          categorySlug: category.slug,
          merchantId: input.merchantId,
          warningMessage: 'Failed to load category compare module inventory',
        }),
      };
    })
  );
}

export async function loadProductsPageLinkModules(input: {
  baseUrl: string;
  categories: ProductsPageLinkModuleCategory[];
  merchantId: string;
  productTotalPages?: number;
}): Promise<StorefrontLinkModule[]> {
  const categoryCompareInputs = await loadCategoryCompareInputs({
    categories: input.categories,
    merchantId: input.merchantId,
  });
  const compareLinks = categoryCompareInputs.flatMap((category) =>
    buildCompareLinkGraph({
      storeUrl: input.baseUrl,
      categorySlug: category.slug,
      categoryName: category.name,
      products: category.products,
      productsAreKnownActive: true,
      maxLinks: 6,
    }).map((entry) => ({
      href: entry.href,
      label: entry.label,
    }))
  );

  return buildCatalogLinkModules({
    compareLinks,
    editorialLinks: [],
  });
}
