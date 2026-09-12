'use client';

import dynamic from 'next/dynamic';
import type { Route } from 'next';
import Link from 'next/link';
import type React from 'react';
import { Fragment, useEffect, useRef, useState } from 'react';
import { prioritizeSmartphoneProducts } from '@baci/shared/storefront';
import { useDeferredActivation } from './deferred-shell-feature';
import type {
  ProductGridInteractionBindingsValue,
  ProductGridParticle,
} from './ProductGridInteractionBindings';
import { DeferredAdUnit } from './deferred-ad-unit';
import { HomeProductGridCard } from './HomeProductGridCard';
import type { ProductGridItemProps } from './ProductGridItem';
import { hasRealProducts, useHomePreviewCatalog } from './useHomePreviewCatalog';
import { useActivationFocusRestore } from './use-activation-focus-restore';
import type { Product } from '../types';
import { joinRouteBasePath, normalizeRouteBasePath } from '@/lib/routes';

const DeferredFloatingParticles = dynamic(
  () => import('./FloatingParticles').then((mod) => mod.FloatingParticles),
  { loading: () => null }
);

interface ProductGridInteractionBindingsModule {
  ProductGridInteractionBindings: React.ComponentType<{
    children: (
      bindings: ProductGridInteractionBindingsValue
    ) => React.ReactNode;
  }>;
}

interface ProductGridItemModule {
  ProductGridItem: React.ComponentType<ProductGridItemProps>;
}

interface PreviewCatalogModule {
  products: Product[];
}

interface HomeProductGridProps {
  basePath?: string;
  storeSlug?: string;
  products?: Product[];
  title?: string;
  showViewAll?: boolean;
  initialDisplayCount?: number;
  inlineAdBreakpoints?: number[];
  loadInteractionBindings?: () => Promise<ProductGridInteractionBindingsModule>;
  loadInteractiveCard?: () => Promise<ProductGridItemModule>;
  loadPreviewCatalog?: () => Promise<PreviewCatalogModule>;
}

const PRODUCTS_PER_PAGE = 20;
const SERVER_RENDERED_HOME_PRODUCT_IMAGES = 2;
const NO_PARTICLES: ProductGridParticle[] = [];

const loadDefaultInteractionBindingsModule = () =>
  import('./ProductGridInteractionBindings');

const loadDefaultInteractiveCardModule = () => import('./ProductGridItem');

const STATIC_BINDINGS: ProductGridInteractionBindingsValue = {
  isAdded: () => false,
  getCartQuantity: () => 0,
  isWishlisted: () => false,
  onAddToCart: (event) => {
    event.preventDefault();
    event.stopPropagation();
  },
  onToggleWishlist: (event) => {
    event.preventDefault();
    event.stopPropagation();
  },
  particles: NO_PARTICLES,
};

export function HomeProductGrid({
  basePath: explicitBasePath,
  storeSlug,
  products,
  title = 'Featured Products',
  showViewAll = true,
  initialDisplayCount = 8,
  inlineAdBreakpoints = [8, 16],
  loadInteractionBindings,
  loadInteractiveCard,
  loadPreviewCatalog,
}: HomeProductGridProps) {
  const [displayCount, setDisplayCount] = useState(
    Math.max(1, initialDisplayCount)
  );
  const [prevInitialDisplayCount, setPrevInitialDisplayCount] = useState(
    initialDisplayCount
  );
  if (initialDisplayCount !== prevInitialDisplayCount) {
    setPrevInitialDisplayCount(initialDisplayCount);
    setDisplayCount(Math.max(1, initialDisplayCount));
  }
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
                    index >= SERVER_RENDERED_HOME_PRODUCT_IMAGES
                  }
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
                    index >= SERVER_RENDERED_HOME_PRODUCT_IMAGES
                  }
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
            className="px-8 py-3 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-xl transition-all duration-200 active:scale-95"
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
