import {
  getCachedCategoryPageData,
  getCachedCategoryPageGraphicsOptions,
} from '@/lib/cached-data';
import {
  type GamingLaptopGraphicsHub,
  getAvailableGamingLaptopGraphicsHubs,
  getGraphicsOptionsForHub,
} from './gaming-laptop-graphics-hubs';

interface LoadPublishedGamingLaptopGraphicsHubsInput {
  categorySlug: string;
  graphicsOptions?: string[];
  merchantId: string;
  storeSlug: string;
}

export async function loadPublishedGamingLaptopGraphicsHubs({
  categorySlug,
  graphicsOptions: suppliedGraphicsOptions,
  merchantId,
  storeSlug,
}: LoadPublishedGamingLaptopGraphicsHubsInput): Promise<
  GamingLaptopGraphicsHub[]
> {
  const graphicsOptions =
    suppliedGraphicsOptions ??
    (await getCachedCategoryPageGraphicsOptions(
      merchantId,
      categorySlug,
      storeSlug
    ));
  const candidates = getAvailableGamingLaptopGraphicsHubs(graphicsOptions);
  const qualification = await Promise.all(
    candidates.map(async (hub) => {
      const data = await getCachedCategoryPageData(
        merchantId,
        categorySlug,
        storeSlug,
        0,
        1,
        { graphics: getGraphicsOptionsForHub(graphicsOptions, hub) }
      );
      const productCount = data.productCount ?? data.products.length;

      return !data.productsQueryFailed &&
        !data.productIdsQueryFailed &&
        productCount >= 2
        ? hub
        : null;
    })
  );

  return qualification.filter(
    (hub): hub is GamingLaptopGraphicsHub => hub !== null
  );
}
