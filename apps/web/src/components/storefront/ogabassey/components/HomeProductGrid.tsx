'use client';

import dynamic from 'next/dynamic';
import type { Route } from 'next';
import Link from 'next/link';
import type React from 'react';
import { Fragment, useEffect, useRef, useState } from 'react';
import { prioritizeSmartphoneProducts } from '@baci/shared/storefront/prioritize-smartphone-products';
import { useDeferredActivation } from './deferred-shell-feature';
import type {
  ProductGridInteractionBindingsValue,
  ProductGridParticle,
} from './ProductGridInteractionBindings';
import { DeferredAdUnit } from './deferred-ad-unit';
import {
  FALLBACK_RENDERED_IMAGE_COUNT,
  PRODUCTS_PER_PAGE,
} from './home-product-grid-constants';
import {
  loadDefaultInteractionBindingsModule,
  loadDefaultInteractiveCardModule,
} from './home-product-grid-interaction-loaders';
import type {
  PreviewCatalogModule,
  ProductGridInteractionBindingsModule,
  ProductGridItemModule,
} from './home-product-grid-interaction-loaders';
import { STATIC_BINDINGS } from './home-product-grid-static-bindings';
import { useFallbackSwapPage } from './home-product-grid-fallback-swap';
import { HomeProductGridCard } from './HomeProductGridCard';
import { hasRealProducts, useHomePreviewCatalog } from './useHomePreviewCatalog';
import { useActivationFocusRestore } from './use-activation-focus-restore';
import type { Product } from '../types';
import { joinRouteBasePath, normalizeRouteBasePath } from '@/lib/routes';

const DeferredFloatingParticles = dynamic(
  () => import('./FloatingParticles').then((mod) => mod.FloatingParticles),
  { loading: () => null }
);

interface HomeProductGridProps {
  basePath?: string;
  storeSlug?: string;
  products?: Product[];
  title?: string;
  showViewAll?: boolean;
  initialDisplayCount?: number;
  /**
   * Replays a load-more tap captured on the static fallback before this
   * grid mounted: the first page expands by one page on mount so the tap
   * is not lost. One-shot — read only in the initial state.
   */
  replayLoadMore?: boolean;
  /**
   * The static fallback rendered the initial slice before this grid
   * mounted: those cards keep the fallback's JPEG tier (no AVIF source)
   * so the swap reuses the already-fetched bytes. Cards expanded later
   * via load-more were never fallback-rendered and keep the AVIF tier.
   * Set by the gate, whose fallback always commits first.
   */
  matchFallbackImageTier?: boolean;
  inlineAdBreakpoints?: number[];
  loadInteractionBindings?: () => Promise<ProductGridInteractionBindingsModule>;
  loadInteractiveCard?: () => Promise<ProductGridItemModule>;
  loadPreviewCatalog?: () => Promise<PreviewCatalogModule>;
}

export function HomeProductGrid({
  basePath: explicitBasePath,
  storeSlug,
  products,
  title = 'Featured Products',
  showViewAll = true,
  initialDisplayCount = 8,
  replayLoadMore = false,
  matchFallbackImageTier = false,
  inlineAdBreakpoints = [8, 16],
  loadInteractionBindings,
  loadInteractiveCard,
  loadPreviewCatalog,
}: HomeProductGridProps) {
  const { displayCount, setDisplayCount, isFallbackTierIndex } =
    useFallbackSwapPage({
      initialDisplayCount,
      replayLoadMore,
      matchFallbackImageTier,
    });
  const [InteractionBindings, setInteractionBindings] = useState<
    ProductGridInteractionBindingsModule['ProductGridInteractionBindings'] | null
  >(null);
  const [InteractiveCard, setInteractiveCard] = useState<
    ProductGridItemModule['ProductGridItem'] | null
  >(null);
  const previewCatalog = useHomePreviewCatalog({
    products,
    loadPreviewCatalog,
  });
  const gridRef = useRef<HTMLElement | null>(null);
  // Grid-scoped focusin activation can swap the subtree out from under a
  // keyboard user's focused element — capture before the swap, restore after.
  const { capture: captureFocusBeforeSwap } = useActivationFocusRestore(
    gridRef,
    Boolean(InteractionBindings && InteractiveCard)
  );
  // Scope activation to the grid itself so pointer/keyboard activity elsewhere
  // on the page (hero, nav, search) never downloads the interactive-card graph.
  const interactionsActivated = useDeferredActivation({
    timeoutMs: 0,
    activateOnIdle: false,
    deferInteractionActivationUntilNextPaint: true,
    interactionTargetRef: gridRef,
  });
  useEffect(() => {
    if (!interactionsActivated || (InteractionBindings && InteractiveCard)) {
      return;
    }

    let cancelled = false;
    const resolveBindingsModule = InteractionBindings
      ? Promise.resolve({
          ProductGridInteractionBindings: InteractionBindings,
        })
      : (loadInteractionBindings ?? loadDefaultInteractionBindingsModule)();
    const resolveInteractiveCardModule = InteractiveCard
      ? Promise.resolve({
          ProductGridItem: InteractiveCard,
        })
      : (loadInteractiveCard ?? loadDefaultInteractiveCardModule)();

    void Promise.all([
      resolveBindingsModule,
      resolveInteractiveCardModule,
    ]).then(([bindingsModule, interactiveCardModule]) => {
      if (cancelled) {
        return;
      }

      captureFocusBeforeSwap();
      setInteractionBindings(() => bindingsModule.ProductGridInteractionBindings);
      setInteractiveCard(() => interactiveCardModule.ProductGridItem);
    });

    return () => {
      cancelled = true;
    };
  }, [
    InteractiveCard,
    InteractionBindings,
    interactionsActivated,
    loadInteractionBindings,
    loadInteractiveCard,
  ]);

  const rawBasePath =
    explicitBasePath ?? (storeSlug ? `/${storeSlug}` : '');
  const basePath = normalizeRouteBasePath(rawBasePath);
  const allProductsHref = joinRouteBasePath(basePath, '/products');
  const allProducts = hasRealProducts(products)
    ? products
    : (previewCatalog ?? []);
  const featuredProducts = prioritizeSmartphoneProducts(allProducts);
  const visibleProducts = featuredProducts.slice(0, displayCount);
  const hasMoreProducts = displayCount < featuredProducts.length;

  const renderGrid = (
    bindings: ProductGridInteractionBindingsValue,
    deferInteractiveChrome: boolean
  ) => (
    <section ref={gridRef} className="ogabassey-home-products">
      <div className="ogabassey-home-products__header">
        <div>
          {title === 'Featured Products' && (
            <span className="ogabassey-home-products__eyebrow">
              Best Sellers
            </span>
          )}
          <h2 className="ogabassey-home-products__title">
            {title}
          </h2>
        </div>
        {showViewAll && (
          <Link
            href={allProductsHref as Route}
            prefetch={false}
            className="ogabassey-home-products__view-all"
          >
            View all products
          </Link>
        )}
      </div>

      {featuredProducts.length === 0 ? (
        <div className="ogabassey-home-products__empty">
          <p className="ogabassey-home-products__empty-text">No products found.</p>
        </div>
      ) : (
        <div className="ogabassey-home-products__grid">
          {visibleProducts.map((product, index) => (
            <Fragment key={product.id}>
              {deferInteractiveChrome || !InteractiveCard ? (
                <HomeProductGridCard
                  basePath={basePath}
                  product={product}
                  deferImageLoading={
                    index >= FALLBACK_RENDERED_IMAGE_COUNT
                  }
                  disableAvifTier={isFallbackTierIndex(index)}
                />
              ) : (
                <InteractiveCard
                  basePath={basePath}
                  product={product}
                  onAddToCart={(event, selectedProduct) =>
                    bindings.onAddToCart(event, selectedProduct)
                  }
                  isAdded={bindings.isAdded(product.id)}
                  cartQuantity={bindings.getCartQuantity(product.id)}
                  viewMode="grid"
                  isWishlisted={bindings.isWishlisted(product.id)}
                  onToggleWishlist={(event) =>
                    bindings.onToggleWishlist(event, product)
                  }
                  deferInteractiveChrome={deferInteractiveChrome}
                  interactiveChromeTimeoutMs={deferInteractiveChrome ? 0 : undefined}
                  interactiveChromeActivateOnIdle={!deferInteractiveChrome}
                  deferImageLoading={
                    index >= FALLBACK_RENDERED_IMAGE_COUNT
                  }
                  disableAvifTier={isFallbackTierIndex(index)}
                />
              )}

              {inlineAdBreakpoints.includes(index + 1) && (
                <div className="col-span-2 lg:col-span-4 flex items-center justify-center my-2 md:my-4">
                  <DeferredAdUnit
                    placementKey="PRODUCT_GRID_MPU"
                    timeoutMs={1}
                  />
                </div>
              )}
            </Fragment>
          ))}
        </div>
      )}

      {hasMoreProducts && (
        <div className="mt-8 flex flex-col items-center gap-2">
          <button
            onClick={() =>
              setDisplayCount((currentCount) => currentCount + PRODUCTS_PER_PAGE)
            }
            type="button"
            className="px-8 py-3 bg-store-primary hover:bg-store-primary/90 text-store-primary-text font-semibold rounded-xl transition-all duration-200 active:scale-95"
          >
            Load More Products
          </button>
          <span className="ogabassey-home-products__count">
            Showing {visibleProducts.length} of {featuredProducts.length}{' '}
            products
          </span>
        </div>
      )}

      {bindings.particles.length > 0 && (
        <DeferredFloatingParticles particles={bindings.particles} />
      )}
    </section>
  );

  if (!InteractionBindings) {
    return renderGrid(STATIC_BINDINGS, true);
  }

  return (
    <InteractionBindings>
      {(bindings) => renderGrid(bindings, false)}
    </InteractionBindings>
  );
}
