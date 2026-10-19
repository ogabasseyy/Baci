import { useEffect, useRef, useState } from 'react';
import type { Layout, ResponsiveLayouts } from 'react-grid-layout/legacy';
import { createDashboardLayoutSaveQueue } from '@/lib/analytics/dashboard-layout-save-queue';
import {
  fetchDashboardLayoutPreference,
  saveDashboardLayoutPreference,
} from '@/lib/analytics/save-dashboard-layout-preference';
import type { AnalyticsCategory } from './analytics-category-nav';
import {
  hydrateDashboardLayoutConfig,
  mergeDashboardLayoutConfig,
} from './analytics-grid-layout-hydration';
import { type Layouts, resolveCategoryLayouts } from './analytics-grid-layouts';

interface AnalyticsGridLayoutInput {
  activeCategory: AnalyticsCategory;
  isEditMode: boolean;
  merchantId?: string;
}

const LAYOUT_BREAKPOINTS = ['lg', 'md', 'sm', 'xs', 'xxs'] as const;

function haveSameLayout(left: Layout, right: Layout): boolean {
  if (left.length !== right.length) return false;
  const rightById = new Map(right.map((item) => [item.i, item]));
  return left.every((item) => {
    const matchingItem = rightById.get(item.i);
    return (
      matchingItem?.x === item.x &&
      matchingItem.y === item.y &&
      matchingItem.w === item.w &&
      matchingItem.h === item.h
    );
  });
}

function haveSameLayouts(left: Layouts, right: Layouts): boolean {
  return LAYOUT_BREAKPOINTS.every((breakpoint) =>
    haveSameLayout(left[breakpoint], right[breakpoint])
  );
}

export function useAnalyticsGridLayout({
  activeCategory,
  isEditMode,
  merchantId,
}: AnalyticsGridLayoutInput) {
  const [layouts, setLayouts] = useState<Layouts>(() =>
    resolveCategoryLayouts(activeCategory)
  );
  const persistedLayoutConfigRef = useRef<unknown>(null);
  const hydrationReadyRef = useRef(!merchantId);
  const pendingLayoutRef = useRef<Layouts | null>(null);
  const layoutSaveQueueRef = useRef(
    createDashboardLayoutSaveQueue(saveDashboardLayoutPreference)
  );
  const [previousSelection, setPreviousSelection] = useState({
    activeCategory,
    merchantId,
  });

  if (
    activeCategory !== previousSelection.activeCategory ||
    merchantId !== previousSelection.merchantId
  ) {
    setPreviousSelection({ activeCategory, merchantId });
    setLayouts(resolveCategoryLayouts(activeCategory));
    hydrationReadyRef.current = !merchantId;
    pendingLayoutRef.current = null;
    persistedLayoutConfigRef.current = null;
  }

  useEffect(() => {
    if (!merchantId) {
      hydrationReadyRef.current = true;
      return;
    }

    const controller = new AbortController();
    hydrationReadyRef.current = false;
    const previousWrites = layoutSaveQueueRef.current.reset();
    persistedLayoutConfigRef.current = null;

    const flushPendingLayout = (layoutConfig: unknown) => {
      const pendingLayout = pendingLayoutRef.current;
      pendingLayoutRef.current = null;
      if (!pendingLayout) return false;

      const nextLayoutConfig = mergeDashboardLayoutConfig(
        layoutConfig,
        activeCategory,
        pendingLayout
      );
      persistedLayoutConfigRef.current = nextLayoutConfig;
      setLayouts(pendingLayout);
      void layoutSaveQueueRef.current
        .enqueue(nextLayoutConfig, merchantId)
        .catch((error: unknown) => {
          if (error instanceof Error && error.name === 'AbortError') return;
          console.error('Failed to save layout:', error);
        });
      return true;
    };

    void previousWrites
      .then(() => {
        if (controller.signal.aborted) return null;
        return fetchDashboardLayoutPreference(merchantId, controller.signal);
      })
      .then((layoutConfig) => {
        if (controller.signal.aborted) return;

        persistedLayoutConfigRef.current = layoutConfig;
        hydrationReadyRef.current = true;
        if (flushPendingLayout(layoutConfig)) return;

        if (!layoutConfig) return;

        const hydratedLayouts = hydrateDashboardLayoutConfig(
          layoutConfig,
          activeCategory
        );
        if (hydratedLayouts) setLayouts(hydratedLayouts);
      })
      .catch((error: unknown) => {
        if (
          controller.signal.aborted ||
          (error instanceof Error && error.name === 'AbortError')
        ) {
          return;
        }
        console.error('Failed to hydrate dashboard layout:', error);
        // Do not flush an edit against a null baseline. A failed preference
        // read may mean the merchant has saved layouts that are temporarily
        // unavailable (or that the caller lacks read permission); replacing
        // the whole JSON document from null would silently delete them. Keep
        // hydration pending so later edits remain local until a successful
        // retry or remount supplies the baseline.
      });

    return () => {
      controller.abort();
      void layoutSaveQueueRef.current.reset();
    };
  }, [activeCategory, merchantId]);

  function onLayoutChange(
    _currentLayout: Layout,
    allLayouts: ResponsiveLayouts
  ) {
    const defaultLayouts = resolveCategoryLayouts(activeCategory);
    const completeLayouts: Layouts = {
      ...defaultLayouts,
      ...allLayouts,
    };
    const nextLayoutConfig = mergeDashboardLayoutConfig(
      persistedLayoutConfigRef.current,
      activeCategory,
      completeLayouts
    );
    setLayouts(completeLayouts);
    if (merchantId && !hydrationReadyRef.current) {
      if (isEditMode && !haveSameLayouts(completeLayouts, defaultLayouts)) {
        pendingLayoutRef.current = completeLayouts;
      }
      return;
    }

    persistedLayoutConfigRef.current = nextLayoutConfig;
    if (!isEditMode) return;

    void layoutSaveQueueRef.current
      .enqueue(nextLayoutConfig, merchantId)
      .catch((error) => {
        if (error instanceof Error && error.name === 'AbortError') return;
        console.error('Failed to save layout:', error);
      });
  }

  return { layouts, onLayoutChange };
}
