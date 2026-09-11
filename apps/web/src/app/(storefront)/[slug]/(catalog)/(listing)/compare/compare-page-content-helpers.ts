import { normalizeProduct, type RawDbProduct } from '@/lib/normalize-product';
import { canonicalizeCategorySlug } from '@/lib/storefront-canonical-url';
import { resolveStorefrontPathHref } from '@/lib/storefront-path-prefix';

export function buildCompareIndexDescription(
  merchantName: string | null | undefined
) {
  const storefrontName = merchantName?.trim() || 'this store';

  return `Browse ${storefrontName} product comparison pages by category and open side-by-side guides for eligible products.`;
}

export interface CompareIndexSection {
  categoryName: string;
  categorySlug: string;
  links: {
    href: string;
    label: string;
  }[];
}

interface CompareCategory {
  name?: string | null;
  slug: string | null;
}

export function toRequestRelativeHref(
  href: string,
  storeUrl: string,
  pathPrefix: string
) {
  if (href.startsWith('/')) {
    return resolveStorefrontPathHref(pathPrefix, href);
  }

  try {
    const url = new URL(href);
    const canonicalStoreUrl = new URL(storeUrl);

    if (url.origin === canonicalStoreUrl.origin) {
      const canonicalStorePathPrefix =
        canonicalStoreUrl.pathname === '/'
          ? ''
          : canonicalStoreUrl.pathname.replace(/\/+$/g, '');
      const relativeHref = `${url.pathname}${url.search}`;

      if (
        canonicalStorePathPrefix &&
        relativeHref.startsWith(`${canonicalStorePathPrefix}/`)
      ) {
        return relativeHref;
      }

      return resolveStorefrontPathHref(pathPrefix, relativeHref);
    }
  } catch {
    return href;
  }

  return href;
}

export function normalizeCompareProduct(
  product: RawDbProduct,
  categorySlug: string
) {
  const normalizedProduct = normalizeProduct(product, {
    preferredCategorySlug: categorySlug,
  });
  const hasJoinedCategory =
    Boolean(product.categories) ||
    (Array.isArray(product.product_categories) &&
      product.product_categories.some((entry) => Boolean(entry.categories)));

  return {
    slug: normalizedProduct.slug,
    name: normalizedProduct.name,
    brand: normalizedProduct.brand,
    price: normalizedProduct.price,
    category_slug:
      hasJoinedCategory && normalizedProduct.category_slug
        ? normalizedProduct.category_slug
        : categorySlug,
    product_key_specs: normalizedProduct.product_key_specs,
  };
}

export function buildCanonicalCompareCategories<
  TCategory extends CompareCategory,
>(categories: TCategory[]) {
  return Array.from(
    new Map(
      categories
        .map((category) => {
          const categorySlug = canonicalizeCategorySlug(category.slug);

          return categorySlug
            ? [categorySlug, { ...category, categorySlug }]
            : null;
        })
        .filter(
          (entry): entry is [string, TCategory & { categorySlug: string }] =>
            entry !== null
        )
    ).values()
  );
}

export function sortCompareSections(
  left: CompareIndexSection,
  right: CompareIndexSection
) {
  return (
    right.links.length - left.links.length ||
    left.categoryName.localeCompare(right.categoryName)
  );
}
