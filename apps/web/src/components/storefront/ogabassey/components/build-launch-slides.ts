import { launchCtaLabel } from '@baci/shared/storefront/launch-carousel';
import { getProductUrl } from '@/lib/product-url';
import type { Product as OgabasseyProduct } from '../types';
import type { LaunchProductSlide } from './LaunchCarousel';

/**
 * Server-side builder for launch carousel product slides. Kept out of the
 * client `LaunchCarousel` so `getProductUrl` (and the rest of `seo-utils`)
 * never enters the client bundle. Products missing a slug or image can't be
 * linked/rendered as a slide and are skipped.
 */
export function buildLaunchSlides(
  products: readonly OgabasseyProduct[],
  basePath: string
): LaunchProductSlide[] {
  const slides: LaunchProductSlide[] = [];

  for (const product of products) {
    if (!product.slug || !product.image) {
      continue;
    }

    const path = getProductUrl({
      id: String(product.id),
      name: product.name,
      slug: product.slug,
      category: product.category,
      categories: product.categories,
      category_slug: product.categorySlug,
      categorySlug: product.categorySlug,
    });

    slides.push({
      kind: 'product',
      id: String(product.id),
      name: product.name,
      priceLabel: product.price,
      href: `${basePath}${path}`,
      imageUrl: product.image,
      imageAlt:
        product.image_alt ??
        (product.brand
          ? `${product.name} — ${product.brand}`
          : product.name),
      ctaLabel: launchCtaLabel(product.name),
    });
  }

  return slides;
}
