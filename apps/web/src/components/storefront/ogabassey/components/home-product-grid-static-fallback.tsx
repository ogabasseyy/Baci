import { getProductImageAlt } from '@baci/shared/lib/product-image-alt';
import { prioritizeSmartphoneProducts } from '@baci/shared/storefront/prioritize-smartphone-products';
import { Fragment } from 'react';
import { PLACEHOLDER_IMAGE } from '@/lib/image-utils';
import { getProductUrl } from '@/lib/product-url';
import { AD_CONFIG } from '../config/ads';
import type { Product } from '../types';
import { AdSlotShell } from './ad-slot-shell';
import { getProductConditionClass } from './product-condition-class';
import { resolveProductImageSource } from './product-image-source';
import { FALLBACK_RENDERED_IMAGE_COUNT } from './home-product-grid-constants';
import { HomeProductGridFallbackImage } from './home-product-grid-fallback-image';
import { ProductRatingRow } from './ProductRatingRow';

interface HomeProductGridStaticFallbackProps {
  basePath?: string;
  products?: Product[];
  title?: string;
  showViewAll?: boolean;
  initialDisplayCount?: number;
  inlineAdBreakpoints?: number[];
  allProductsHref?: string;
  /**
   * How many leading cards render a real `<img>`. Defaults to
   * FALLBACK_RENDERED_IMAGE_COUNT (shared with the swap-tier predicate):
   * the remaining cards render the same placeholder shell the
   * interactive card shows pre-activation, so below-fold product images
   * never compete with LCP for bandwidth — even on fast connections
   * where lazy-load thresholds expand.
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
  inlineAdBreakpoints = [],
  allProductsHref,
  serverRenderedImageCount = FALLBACK_RENDERED_IMAGE_COUNT,
}: HomeProductGridStaticFallbackProps) {
  const prioritizedProducts = prioritizeSmartphoneProducts(products);
  const visibleProducts = prioritizedProducts.slice(
    0,
    Math.max(1, initialDisplayCount)
  );
  // The interactive grid appends its load-more button + count row for this
  // same condition; without a geometry-matched twin the gate swap inserts
  // the whole row and shifts the discovery section and footer (visible when
  // the backstop fires or the shopper reaches the grid pre-chunk).
  const hasMoreProducts = visibleProducts.length < prioritizedProducts.length;

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
              <Fragment key={product.id}>
                <div className="ogabassey-home-product-card">
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

                {inlineAdBreakpoints.includes(index + 1) && (
                  <div
                    aria-hidden="true"
                    className="col-span-2 -mx-3 my-2 hidden items-center justify-center min-[300px]:flex sm:mx-0 md:my-4 lg:col-span-4"
                  >
                    <AdSlotShell
                      ariaHidden
                      height={AD_CONFIG.PRODUCT_GRID_MPU.height}
                      mobileHeight={AD_CONFIG.PRODUCT_GRID_MPU.mobileHeight}
                      mobileWidth={AD_CONFIG.PRODUCT_GRID_MPU.mobileWidth}
                      name={AD_CONFIG.PRODUCT_GRID_MPU.name}
                      width={AD_CONFIG.PRODUCT_GRID_MPU.width}
                    />
                  </div>
                )}
              </Fragment>
            );
          })}
        </div>
      )}

      {hasMoreProducts && (
        // aria-hidden + handler-free tabIndex=-1 (not inert): the control
        // takes no tab stop and stays out of the accessibility tree, but
        // taps still dispatch click so the gate can capture and replay a
        // pre-resolution load-more tap after the grid mounts. `inert`
        // would suppress the click entirely and the tap would be lost.
        <div
          className="mt-8 flex flex-col items-center gap-2"
          aria-hidden="true"
        >
          <button
            type="button"
            tabIndex={-1}
            data-ogabassey-home-products-more="true"
            className="px-8 py-3 bg-store-primary text-store-primary-text font-semibold rounded-xl cursor-pointer"
          >
            Load More Products
          </button>
          <span className="ogabassey-home-products__count">
            Showing {visibleProducts.length} of {prioritizedProducts.length}{' '}
            products
          </span>
        </div>
      )}
    </section>
  );
}
