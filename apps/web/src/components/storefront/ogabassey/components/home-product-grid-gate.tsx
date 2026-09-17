'use client';

import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { useViewportActivation } from '@/components/storefront/use-viewport-activation';
import type { Product } from '../types';

interface HomeProductGridModule {
  HomeProductGrid: React.ComponentType<HomeProductGridGateGridProps>;
}

export interface HomeProductGridGateGridProps {
  basePath?: string;
  storeSlug?: string;
  products?: Product[];
  title?: string;
  showViewAll?: boolean;
  initialDisplayCount?: number;
  inlineAdBreakpoints?: number[];
}

interface HomeProductGridGateProps extends HomeProductGridGateGridProps {
  /**
   * Server-rendered static snapshot shown until the section approaches the
   * viewport. Keeps product links/names/prices in SSR HTML with zero JS.
   */
  fallback: ReactNode;
  /** Test seam (mirrors DeferredAdUnit.loadAdUnitModule). */
  loadGridModule?: () => Promise<HomeProductGridModule>;
  /**
   * Backstop load delay when the section never approaches the viewport.
   * Defaults to 8s so the interactive layer still arrives for non-scrollers
   * without competing with LCP.
   */
  timeoutMs?: number;
}

// Module-scope so the dynamic import() expression stays outside the component
// body (React Compiler cannot lower import expressions). Code splitting is
// unaffected: the chunk still loads on first activation only.
const loadDefaultGridModule = () => import('./HomeProductGrid');

/**
 * Viewport gate for the homepage featured-products grid. Renders the static
 * fallback (SSR HTML, zero JS) until the section is within 600px of the
 * viewport — or the backstop timeout fires — then loads the interactive
 * grid module on demand. Below-fold grid JS stays out of the initial bundle.
 */
export function HomeProductGridGate({
  fallback,
  loadGridModule = loadDefaultGridModule,
  timeoutMs = 8000,
  ...gridProps
}: HomeProductGridGateProps) {
  const { ref, isActive } = useViewportActivation<HTMLDivElement>({
    rootMargin: '600px 0px',
    timeoutMs,
  });
  const [Grid, setGrid] =
    useState<HomeProductGridModule['HomeProductGrid'] | null>(null);

  useEffect(() => {
    if (!isActive || Grid) {
      return;
    }

    let cancelled = false;

    void loadGridModule()
      .then((module) => {
        if (!cancelled) {
          setGrid(() => module.HomeProductGrid);
        }
      })
      .catch((error: unknown) => {
        console.error('[HomeProductGridGate] Failed to load grid module', error);
      });

    return () => {
      cancelled = true;
    };
  }, [Grid, isActive, loadGridModule]);

  if (!isActive || !Grid) {
    return <div ref={ref}>{fallback}</div>;
  }

  return <Grid {...gridProps} />;
}
