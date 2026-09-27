import {
  buildGamingLaptopGraphicsHubPath,
  GAMING_LAPTOPS_CATEGORY_SLUG,
} from '@/lib/storefront-category/gaming-laptop-graphics-hubs';
import { loadPublishedGamingLaptopGraphicsHubs } from '@/lib/storefront-category/load-published-gaming-laptop-graphics-hubs';

type CategoryPageStoreLike = { id: string };

type LoadGraphicsHubLinksArgs = {
  readonly category: string;
  readonly graphicsOptions?: string[];
  readonly requestScopedBaseUrl: string;
  readonly slug: string;
  readonly store: CategoryPageStoreLike;
};

export type GraphicsHubLink = { href: string; label: string };

export async function loadGraphicsHubLinks({
  category,
  graphicsOptions,
  requestScopedBaseUrl,
  slug,
  store,
}: LoadGraphicsHubLinksArgs): Promise<GraphicsHubLink[]> {
  if (category !== GAMING_LAPTOPS_CATEGORY_SLUG) {
    return [];
  }
  const publishedGraphicsHubs = await loadPublishedGamingLaptopGraphicsHubs({
    categorySlug: category,
    graphicsOptions,
    merchantId: store.id,
    storeSlug: slug,
  }).catch(() => []);
  return publishedGraphicsHubs.map((hub) => ({
    href: `${requestScopedBaseUrl}${buildGamingLaptopGraphicsHubPath(
      category,
      hub.slug
    )}`,
    label: `Shop ${hub.label} gaming laptops`,
  }));
}
