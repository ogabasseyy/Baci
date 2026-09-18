'use client';

import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { useViewportActivation } from '@/components/storefront/use-viewport-activation';
import type { Product } from '../types';
import { useActivationFocusRestore } from './use-activation-focus-restore';

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
 * fallback (SSR HTML, zero JS) until the shopper's first interaction or
 * the post-LCP signal — which then honors the 600px approach margin and
 * the backstop timeout — then loads the interactive grid module on demand.
 * Below-fold grid JS stays out of the initial bundle AND the LCP window.
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
    // The grid follows only the hero, utility panel, and strip-ad slot —
    // inside the expanded initial root on mobile viewports — so an ungated
    // observer would import the chunk on hydration, mid-LCP. Activation
    // waits for the shopper's first interaction or the post-LCP signal.
    deferUntilLcp: true,
  });
  const [Grid, setGrid] =
    useState<HomeProductGridModule['HomeProductGrid'] | null>(null);

  // Replacing the fallback unmounts the focused node and drops keyboard
  // focus to <body> — capture before the swap, restore the matching
  // control (same link href, or same button label) after the grid mounts.
  // The same div wraps both branches so the container ref stays valid
  // across the swap.
  const { capture: captureFocusBeforeSwap } = useActivationFocusRestore(
    ref,
    Grid !== null
  );

  useEffect(() => {
    if (!isActive || Grid) {
      return;
    }

    let cancelled = false;

    void loadGridModule()
      .then((module) => {
        if (!cancelled) {
          captureFocusBeforeSwap();
          setGrid(() => module.HomeProductGrid);
        }
      })
      .catch((error: unknown) => {
        console.error('[HomeProductGridGate] Failed to load grid module', error);
      });

    return () => {
      cancelled = true;
    };
    // captureFocusBeforeSwap is a stable per-render closure over the ref;
    // re-running the load effect on its identity change would refetch.
    // biome-ignore lint/correctness/useExhaustiveDependencies: see above.
  }, [Grid, isActive, loadGridModule]);

  if (!isActive || !Grid) {
    return <div ref={ref}>{fallback}</div>;
  }

  return (
    <div ref={ref}>
      <Grid {...gridProps} />
    </div>
  );
}
