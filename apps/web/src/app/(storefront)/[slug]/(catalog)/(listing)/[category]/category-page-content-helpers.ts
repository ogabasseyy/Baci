import type { Product as OgabasseyProduct } from '@/components/storefront/ogabassey/types';
import type { getCachedCategoryPageData } from '@/lib/cached-data';
import { formatCurrencyCompact } from '@/lib/currency';
import {
  normalizeProduct,
  type ProductKeySpecsRecord,
  type RawDbProduct,
} from '@/lib/normalize-product';
import type { Product as SeoProduct } from '@/lib/products';
import { buildCategoryHubModel } from '@/lib/storefront-category/build-category-hub-model';
import type {
  BrandAuthorityEntry,
  CategoryHubComparisonLink,
} from '@/lib/storefront-category/category-hub-types';
import type { getPublishedClusterPosts } from '@/lib/storefront-content/get-published-cluster-posts';

type CategoryPageData = Awaited<ReturnType<typeof getCachedCategoryPageData>>;

export type StorefrontCategoryProduct = OgabasseyProduct & {
  rawPrice: number;
  category_slug: string;
  product_key_specs?: ProductKeySpecsRecord;
};

const CONDITION_MAP: Record<string, OgabasseyProduct['condition']> = {
  New: 'New',
  new: 'New',
  Used: 'Used',
  used: 'Used',
  'Open Box': 'Open Box',
  open_box: 'Open Box',
  Refurbished: 'refurbished',
  refurbished: 'refurbished',
};

export function resolveCategoryPageName(
  data: CategoryPageData,
  categorySlug: string
) {
  return data.isCollection
    ? data.name || categorySlug
    : data.fallbackName || categorySlug;
}

export function getCategoryPageProductSlots(
  data: CategoryPageData
): Array<RawDbProduct | null> {
  return (data.productSlots ?? data.products) as Array<RawDbProduct | null>;
}

export function isCategoryPageProductSlot(
  product: RawDbProduct | null
): product is RawDbProduct {
  return product !== null;
}

export function normalizeCategoryPageProducts(
  products: RawDbProduct[],
  preferredCategorySlug?: string,
  countryCode: string | null = 'NG'
): StorefrontCategoryProduct[] {
  const safeCountryCode = countryCode || 'NG';

  return products.map((product) => {
    const normalized = normalizeProduct(product, {
      preferredCategorySlug,
    });

    return {
      id: normalized.id,
      name: normalized.name,
      slug: normalized.slug,
      description: normalized.description,
      price: formatCurrencyCompact(normalized.price, safeCountryCode),
      rawPrice: normalized.price,
      image: normalized.image,
      images: normalized.images,
      category: normalized.category,
      brand: normalized.brand ?? undefined,
      condition: CONDITION_MAP[normalized.condition] || 'New',
      stock: normalized.stock,
      category_slug: normalized.category_slug,
      product_key_specs: normalized.product_key_specs ?? undefined,
    };
  });
}

export function buildCategoryPageHubModel(input: {
  data: CategoryPageData;
  categorySlug: string;
  categoryName: string;
  merchantBusinessName: string;
  storeUrl: string;
  products: StorefrontCategoryProduct[];
  comparisonLinks?: CategoryHubComparisonLink[];
  guidePosts?: Awaited<ReturnType<typeof getPublishedClusterPosts>>;
  brandAuthorityEntries?: Array<
    BrandAuthorityEntry & {
      productCount: number;
      productCountIsLowerBound?: boolean;
    }
  >;
}) {
  return buildCategoryHubModel({
    categorySlug: input.categorySlug,
    categoryName: input.categoryName,
    merchantBusinessName: input.merchantBusinessName,
    storeUrl: input.storeUrl,
    guidePosts: input.guidePosts ?? [],
    comparisonLinks: input.comparisonLinks,
    brandAuthorityEntries: input.brandAuthorityEntries,
    products: input.products.map((product) => ({
      slug: product.slug || '',
      name: product.name,
      brand: product.brand,
      condition: product.condition,
      price: product.rawPrice,
      category_slug: product.category_slug,
      product_key_specs: product.product_key_specs,
    })),
    categorySeo: input.data.isCollection
      ? undefined
      : {
          heading: input.data.category?.seo_heading,
          description: input.data.category?.seo_description,
          features: input.data.category?.seo_features,
          faqs: input.data.category?.seo_faq,
        },
    collectionSeo: input.data.isCollection ? input.data.seo : undefined,
    isCollection: input.data.isCollection,
  });
}

export function hasMaintainedCategoryCompareHubLink(
  comparisonLinks: CategoryHubComparisonLink[],
  categorySlug: string
) {
  const hubPathSuffix = `/${categorySlug}/compare`;

  return comparisonLinks.some((link) => {
    const [pathOnly] = link.href.trim().split(/[?#]/);
    const pathname = pathOnly.replace(/\/+$/, '');

    return pathname.endsWith(hubPathSuffix);
  });
}

export function toCollectionSchemaProduct(
  product: StorefrontCategoryProduct
): SeoProduct {
  return {
    id: String(product.id),
    name: product.name,
    description: product.description,
    status: 'active',
    price: product.rawPrice,
    manage_stock: true,
    stock: product.stock ?? 0,
    image: product.image,
    imageLarge: product.image,
    imageHint: '',
    brand: product.brand ?? '',
    gtin: '',
    mpn: '',
    category: product.category,
    category_slug: product.category_slug,
    slug: product.slug,
    // Case-insensitive comparison: DB values can be 'Refurbished' /
    // 'refurbished' / 'REFURBISHED'. Normalising here prevents refurbished
    // products from silently falling through to the `'new'` default.
    condition: (() => {
      const normalized = product.condition?.toLowerCase();
      if (normalized === 'used') return 'used';
      if (normalized === 'open box' || normalized === 'open_box')
        return 'open_box';
      if (normalized === 'refurbished') return 'refurbished';
      return 'new';
    })(),
    product_key_specs: product.product_key_specs ?? undefined,
  };
}
