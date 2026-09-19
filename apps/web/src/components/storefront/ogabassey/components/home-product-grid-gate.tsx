'use client';

import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
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
  /**
   * When true, the grid replays one pending "load more" expansion on mount.
   * Set by the gate when a compressed load-more press arrived while the
   * interactive module was still loading.
   */
  replayLoadMore?: boolean;
  /**
   * See HomeProductGrid.matchFallbackImageTier. Always true from the gate:
   * the static fallback commits before the grid module can load, so the
   * initial slice it rendered is already fetched in the JPEG tier.
   */
  matchFallbackImageTier?: boolean;
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

// Maximum time the gate holds a loaded grid on the fallback while a press
// is in flight, awaiting its completion (click/up/cancel). Mirrors
// HeroUtilityPanelGate.
const PRESS_SETTLE_TIMEOUT_MS = 500;

/**
 * Viewport gate for the homepage featured-products grid. Renders the static
 * fallback (SSR HTML, zero JS) until the shopper's first interaction or
 * the post-LCP signal — which then honors the 600px approach margin and
 * the backstop timeout — then loads the interactive grid module on demand.
 * Below-fold grid JS stays out of the initial bundle AND the LCP window.
 * A rejected import parks and retries on the next interaction instead of
 * wedging the fallback permanently.
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
  // A rejected grid import parks here instead of retrying in a loop: the
  // next interaction clears it and re-arms the load effect, so an offline
  // or stale-deployment blip recovers on the following scroll or tap
  // instead of leaving the static fallback (and its inert Load More row)
  // permanently mounted. Same contract as HeroUtilityPanelGate.
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  // A press began (pointerdown) but has not completed (up/click/cancel).
  // While set, a loaded grid holds the fallback mounted so the completing
  // click still lands on the pressed link and navigates natively — without
  // this, a cached-fast chunk swaps between pointerdown and click and the
  // first tap is swallowed. Same contract as HeroUtilityPanelGate.
  const [pressHeld, setPressHeld] = useState(false);
  // A load-more tap captured on the fallback before the grid mounted.
  // Replayed once via the grid's replay prop so the tap is not lost.
  const [pendingLoadMore, setPendingLoadMore] = useState(false);
  const [settleEpoch, setSettleEpoch] = useState(0);
  const pointerDownRef = useRef(false);

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
    // Capture stays armed while the fallback is mounted — not just until
    // first activation, and crucially THROUGH a loaded grid held back by
    // an in-flight press. Only the committed swap unsubscribes.
    if (Grid !== null && !pressHeld) {
      return;
    }

    // A later interaction after a failed load retries the import (the
    // load effect re-runs on the attempt bump). Each retry needs a fresh
    // interaction — no timer loop, no render loop.
    const retryAfterFailure = () => {
      if (loadFailed) {
        setLoadFailed(false);
        setLoadAttempt((attempt) => attempt + 1);
      }
    };

    const handlePointerDown = () => {
      pointerDownRef.current = true;
      setPressHeld(true);
      retryAfterFailure();
    };

    // The completing click lands on the still-mounted fallback link and
    // navigates natively; releasing here lets the swap commit after it. A
    // click on the load-more row additionally records the action for
    // replay: the fallback control is handler-free, so without capture
    // the tap would activate the grid but show no more products.
    const handleClick = (event: MouseEvent) => {
      pointerDownRef.current = false;
      setPressHeld(false);
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest('[data-ogabassey-home-products-more="true"]')
      ) {
        setPendingLoadMore(true);
      }
      retryAfterFailure();
    };

    // Release updates pointer tracking but NOT the hold: the click that
    // completes the press dispatches after pointerup, and swapping between
    // the two would unmount the pressed link before the click lands
    // (losing the tap and its navigation). The click below releases the
    // hold; a press that produces no click settles via cancel, blur, or
    // the settle timer.
    const handlePointerUp = () => {
      pointerDownRef.current = false;
    };

    const handlePointerCancel = () => {
      pointerDownRef.current = false;
      setPressHeld(false);
    };

    const handleKeyDown = () => {
      retryAfterFailure();
    };

    // The page lost focus mid-press: the gesture can never complete.
    const handleBlur = () => {
      pointerDownRef.current = false;
      setPressHeld(false);
    };

    window.addEventListener('pointerdown', handlePointerDown, {
      passive: true,
    });
    window.addEventListener('click', handleClick);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerCancel);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('click', handleClick);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerCancel);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('blur', handleBlur);
    };
  }, [Grid, pressHeld, ref, loadFailed]);

  useEffect(() => {
    if (!isActive || Grid || loadFailed) {
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
        if (!cancelled) {
          setLoadFailed(true);
        }
      });

    return () => {
      cancelled = true;
    };
    // captureFocusBeforeSwap is a stable per-render closure over the ref;
    // re-running the load effect on its identity change would refetch.
    // biome-ignore lint/correctness/useExhaustiveDependencies: see above.
  }, [Grid, isActive, loadGridModule, loadFailed, loadAttempt]);

  // Bound the press hold like HeroUtilityPanelGate: a press with no
  // observable completion must not wedge the loaded grid behind the
  // fallback, but a press that outlasts the bound with the pointer still
  // down is a genuine long press — the hold extends until release.
  useEffect(() => {
    if (Grid === null || !pressHeld) {
      return;
    }
    const settleTimer = setTimeout(() => {
      if (pointerDownRef.current) {
        setSettleEpoch((epoch) => epoch + 1);
      } else {
        setPressHeld(false);
      }
    }, PRESS_SETTLE_TIMEOUT_MS);
    return () => {
      clearTimeout(settleTimer);
    };
  }, [Grid, pressHeld, settleEpoch]);

  // Hold the fallback mounted while a press is in flight against a loaded
  // grid, so the completing click can still land on the pressed link.
  const holdSwapForPress = Grid !== null && pressHeld;

  if (!isActive || !Grid || holdSwapForPress) {
    return <div ref={ref}>{fallback}</div>;
  }

  return (
    <div ref={ref}>
      <Grid
        {...gridProps}
        replayLoadMore={pendingLoadMore}
        matchFallbackImageTier
      />
    </div>
  );
}
