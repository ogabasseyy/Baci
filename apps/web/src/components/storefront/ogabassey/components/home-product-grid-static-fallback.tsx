import { getProductImageAlt } from '@baci/shared/lib';
import { prioritizeSmartphoneProducts } from '@baci/shared/storefront/prioritize-smartphone-products';
import { PLACEHOLDER_IMAGE } from '@/lib/image-utils';
import { getOgabasseyImageFormatProps } from '@/lib/ogabassey-image-format-sources';
import { getProductUrl } from '@/lib/product-url';
import type { Product } from '../types';
import { getProductConditionClass } from './product-condition-class';
import {
  HOME_PRODUCT_GRID_CARD_IMAGE_SIZES,
  resolveProductImageSource,
} from './product-image-source';
import { ProductRatingRow } from './ProductRatingRow';

interface HomeProductGridStaticFallbackProps {
  basePath?: string;
  products?: Product[];
  title?: string;
  showViewAll?: boolean;
  initialDisplayCount?: number;
  allProductsHref?: string;
  /**
   * How many leading cards render a real `<img>`. Mirrors
   * SERVER_RENDERED_HOME_PRODUCT_IMAGES in HomeProductGrid: the remaining
   * cards render the same placeholder shell the interactive card shows
   * pre-activation, so below-fold product images never compete with LCP for
   * bandwidth — even on fast connections where lazy-load thresholds expand.
   */
  serverRenderedImageCount?: number;
}

/**
 * Server-rendered static snapshot of the featured-products section.
 *
 * Paints the same section shell, heading, and first-N product cards as the
 * interactive grid — with plain anchors and lazy native images instead of
 * client components — so SSR HTML keeps the product links, names, prices,
 * and image alts for crawlers and no-JS readers while the interactive grid
 * module stays out of the initial JavaScript bundle. The gate swaps this
 * for the full grid when the section approaches the viewport.
 *
 * Geometry-affecting classes intentionally match HomeProductGridCard (see
 * storefront-home-critical.css) so the swap does not shift layout.
 */
export function HomeProductGridStaticFallback({
  basePath = '',
  products = [],
  title = 'Featured Products',
  showViewAll = true,
  initialDisplayCount = 8,
  allProductsHref,
  serverRenderedImageCount = 2,
}: HomeProductGridStaticFallbackProps) {
  const visibleProducts = prioritizeSmartphoneProducts(products).slice(
    0,
    Math.max(1, initialDisplayCount)
  );

  return (
    <section className="ogabassey-home-products">
      <div className="ogabassey-home-products__header">
        <div>
          {title === 'Featured Products' && (
            <span className="ogabassey-home-products__eyebrow">
              Best Sellers
            </span>
          )}
          <h2 className="ogabassey-home-products__title">{title}</h2>
        </div>
        {showViewAll && (
          <a
            href={allProductsHref ?? `${basePath}/products`}
            className="ogabassey-home-products__view-all"
          >
            View all products
          </a>
        )}
      </div>

      {visibleProducts.length === 0 ? (
        <div className="ogabassey-home-products__empty">
          <p className="ogabassey-home-products__empty-text">
            No products found.
          </p>
        </div>
      ) : (
        <div className="ogabassey-home-products__grid">
          {visibleProducts.map((product, index) => {
            const shouldRenderImage = index < serverRenderedImageCount;
            const productHref = `${basePath}${getProductUrl({ ...product, id: String(product.id) })}`;
            const productImage = resolveProductImageSource(
              [product.image, product.images?.[0]],
              PLACEHOLDER_IMAGE
            );
            const productImageAlt = productImage.isPlaceholder
              ? ''
              : getProductImageAlt(product, {
                  renderedImageUrl: productImage.src,
                });

            return (
              <div key={product.id} className="ogabassey-home-product-card">
                <a
                  href={productHref}
                  title={
                    `${product.name}${product.brand ? ` - ${product.brand}` : ''}`.trim()
                  }
                  className="absolute inset-0 z-0"
                >
                  <span className="sr-only">
                    View {product.name} for {product.price}
                  </span>
                </a>

                <div className="ogabassey-home-product-card__media">
                  {product.condition && (
                    <div
                      className={`ogabassey-home-product-card__condition ${getProductConditionClass(product.condition)}`}
                    >
                      {product.condition}
                    </div>
                  )}

                  {shouldRenderImage ? (
                    <HomeProductGridFallbackImage
                      alt={productImageAlt}
                      src={productImage.src}
                    />
                  ) : (
                    <div className="ogabassey-home-product-card__placeholder" />
                  )}
                </div>

                <div className="ogabassey-home-product-card__body">
                  <h3 className="ogabassey-home-product-card__title">
                    {product.name}
                    {product.spec && (
                      <span className="ogabassey-home-product-card__spec">
                        {product.spec}
                      </span>
                    )}
                  </h3>

                  <ProductRatingRow rating={product.rating} />

                  <div className="ogabassey-home-product-card__footer">
                    <span className="ogabassey-home-product-card__price">
                      {product.price}
                    </span>
                    <span className="ogabassey-home-product-card__details">
                      Details
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/**
 * Server-rendered twin of the interactive card's `CdnFormatImage`: the same
 * `getImageProps` inputs (src, fill, shared sizes ladder, lazy, low
 * priority) through the same per-format helper, emitting the same
 * `<picture>` + AVIF `<source>` + `<img>` DOM. The browser therefore picks
 * byte-identical candidates before the gate swap and after, so the
 * below-fold product image is fetched once and served from cache —
 * the previous hand-rolled jpeg `<img>` used a different URL than the
 * card's AVIF tier and caused a second fetch on swap.
 *
 * Absolute fill mirrors CdnFormatImage `fill` (no CLS). Non-CDN sources
 * have no AVIF tier and render the same plain `<img>` the card renders.
 */
function HomeProductGridFallbackImage({
  alt,
  src,
}: {
  alt: string;
  src: string;
}) {
  const { avifSource, imgProps } = getOgabasseyImageFormatProps({
    alt,
    fetchPriority: 'low',
    fill: true,
    loading: 'lazy',
    sizes: HOME_PRODUCT_GRID_CARD_IMAGE_SIZES,
    src,
  });

  // biome-ignore lint/performance/noImgElement: intentional — per-format
  // <picture> tiers require a raw <img>; props come from getImageProps so
  // this stays next/image-equivalent, matching CdnFormatImage.
  const img = (
    <img
      {...imgProps}
      alt={alt}
      className="ogabassey-home-product-card__image"
      decoding="async"
      loading="lazy"
      style={{
        ...imgProps.style,
        height: '100%',
        inset: 0,
        position: 'absolute',
        width: '100%',
      }}
    />
  );

  if (!avifSource) {
    return img;
  }

  return (
    <picture style={{ display: 'contents' }}>
      <source
        sizes={avifSource.sizes}
        srcSet={avifSource.srcSet}
        type="image/avif"
      />
      {img}
    </picture>
  );
}
