import {
  getCachedCategoryPageData,
  getCachedCategoryPageGraphicsOptionsStrict,
  getMerchantByIdentifier,
} from '@/lib/cached-data';
import { getCountryByCode } from '@/lib/countries';
import { buildStoreUrl } from '@/lib/store-url';
import {
  buildGamingLaptopGraphicsHubPath,
  GAMING_LAPTOPS_CATEGORY_SLUG,
  getGamingLaptopGraphicsHub,
  getGraphicsOptionsForHub,
} from '@/lib/storefront-category/gaming-laptop-graphics-hubs';
import { loadPublishedGamingLaptopGraphicsHubs } from '@/lib/storefront-category/load-published-gaming-laptop-graphics-hubs';
import { STOREFRONT_PRODUCTS_PER_PAGE } from '@/lib/storefront-pagination';

interface LoadGamingGraphicsHubInput {
  categorySlug: string;
  currentPage: number;
  graphicsSlug: string;
  merchantSlug: string;
}

export async function loadGamingGraphicsHub({
  categorySlug,
  currentPage,
  graphicsSlug,
  merchantSlug,
}: LoadGamingGraphicsHubInput) {
  if (categorySlug !== GAMING_LAPTOPS_CATEGORY_SLUG) return null;

  const hub = getGamingLaptopGraphicsHub(graphicsSlug);
  if (!hub) return null;

  const merchant = await getMerchantByIdentifier(merchantSlug);
  if (!merchant) return null;

  // Strict read: a transient facet failure must surface as an error (the
  // route's error boundary), never as a 404 for a valid hub. Only a
  // successful read with no matching inventory returns null below.
  const graphicsOptions = await getCachedCategoryPageGraphicsOptionsStrict(
    merchant.id,
    categorySlug
  );
  const availableHubs = await loadPublishedGamingLaptopGraphicsHubs({
    categorySlug,
    graphicsOptions,
    merchantId: merchant.id,
    storeSlug: merchantSlug,
  });
  if (!availableHubs.some((candidate) => candidate.slug === hub.slug)) {
    return null;
  }
  const matchingGraphics = getGraphicsOptionsForHub(graphicsOptions, hub);
  if (matchingGraphics.length === 0) return null;

  const productOffset = (currentPage - 1) * STOREFRONT_PRODUCTS_PER_PAGE;
  const data = await getCachedCategoryPageData(
    merchant.id,
    categorySlug,
    merchantSlug,
    productOffset,
    STOREFRONT_PRODUCTS_PER_PAGE,
    { graphics: matchingGraphics }
  );
  if (data.productsQueryFailed || data.productIdsQueryFailed) {
    throw new Error('Gaming graphics hub inventory is temporarily unavailable');
  }

  const productCount = data.productCount ?? data.products.length;
  if (productCount < 2) return null;

  const totalPages = Math.max(
    1,
    Math.ceil(productCount / STOREFRONT_PRODUCTS_PER_PAGE)
  );
  if (currentPage > totalPages) return null;

  const baseUrl = buildStoreUrl(merchant);
  const canonicalBaseUrl = `${baseUrl}${buildGamingLaptopGraphicsHubPath(
    categorySlug,
    hub.slug
  )}`;
  const countryName = getCountryByCode(merchant.country || 'NG')?.name;

  return {
    availableHubs,
    canonicalBaseUrl,
    countryName: countryName || 'your location',
    currentPage,
    hub,
    matchingGraphics,
    merchant,
    productCount,
    totalPages,
  };
}
