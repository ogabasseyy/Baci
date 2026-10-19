import type {
  Layout,
  LayoutItem,
  ResponsiveLayouts,
} from 'react-grid-layout/legacy';

import type { AnalyticsCategory } from './analytics-category-nav';
import {
  ANALYTICS_WIDGET_IDS_BY_CATEGORY,
  type LayoutBreakpoint,
  type Layouts,
  resolveCategoryLayouts,
} from './analytics-grid-layouts';

export type DashboardLayoutConfig =
  | Layout
  | ResponsiveLayouts
  | Partial<Record<AnalyticsCategory, Layout | ResponsiveLayouts>>;

const LAYOUT_BREAKPOINTS: readonly LayoutBreakpoint[] = [
  'lg',
  'md',
  'sm',
  'xs',
  'xxs',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function parseLayout(value: unknown): LayoutItem[] {
  if (!Array.isArray(value)) return [];

  return value.filter((item): item is LayoutItem => {
    if (!isRecord(item)) return false;
    return (
      typeof item.i === 'string' &&
      isFiniteNumber(item.x) &&
      isFiniteNumber(item.y) &&
      isFiniteNumber(item.w) &&
      isFiniteNumber(item.h)
    );
  });
}

function mergeSavedLayout(
  defaultLayout: Layout | undefined,
  savedLayout: LayoutItem[],
  visibleWidgetIds: ReadonlySet<string>
): Layout {
  const savedById = new Map(
    savedLayout
      .filter((item) => visibleWidgetIds.has(item.i))
      .map((item) => [item.i, item] as const)
  );

  return (defaultLayout ?? []).map(
    (defaultItem) => savedById.get(defaultItem.i) ?? defaultItem
  );
}

/**
 * Converts the persisted layout format into the responsive layout shape used
 * by ReactGridLayout. Older saves stored one Layout[] array; those entries
 * are treated as the desktop layout while untouched breakpoints retain their
 * category defaults.
 */
export function hydrateDashboardLayoutConfig(
  layoutConfig: unknown,
  category: AnalyticsCategory
): Layouts | null {
  const defaults = resolveCategoryLayouts(category);
  const visibleWidgetIds = new Set(ANALYTICS_WIDGET_IDS_BY_CATEGORY[category]);

  if (Array.isArray(layoutConfig)) {
    const legacyLayout = parseLayout(layoutConfig);
    if (legacyLayout.length === 0) return null;

    return {
      ...defaults,
      lg: mergeSavedLayout(defaults.lg, legacyLayout, visibleWidgetIds),
    };
  }

  if (!isRecord(layoutConfig)) return null;

  if (category in layoutConfig) {
    return hydrateDashboardLayoutConfig(layoutConfig[category], category);
  }

  let foundSavedLayout = false;
  const hydratedLayouts = { ...defaults };

  for (const breakpoint of LAYOUT_BREAKPOINTS) {
    const savedLayout = parseLayout(layoutConfig[breakpoint]);
    if (savedLayout.length === 0) continue;

    foundSavedLayout = true;
    hydratedLayouts[breakpoint] = mergeSavedLayout(
      defaults[breakpoint],
      savedLayout,
      visibleWidgetIds
    );
  }

  return foundSavedLayout ? hydratedLayouts : null;
}

/** Updates one category while retaining saved layouts for every other category. */
export function mergeDashboardLayoutConfig(
  layoutConfig: unknown,
  category: AnalyticsCategory,
  layouts: Layouts
): DashboardLayoutConfig {
  const categoryKeys = Object.keys(
    ANALYTICS_WIDGET_IDS_BY_CATEGORY
  ) as AnalyticsCategory[];
  const existing = isRecord(layoutConfig)
    ? layoutConfig
    : ({} as Record<string, unknown>);
  const isCategorized = categoryKeys.some((key) => key in existing);
  const next: Partial<Record<AnalyticsCategory, Layout | Layouts>> = {};

  if (isCategorized) {
    for (const key of categoryKeys) {
      const hydrated = hydrateDashboardLayoutConfig(existing[key], key);
      if (hydrated) next[key] = hydrated;
    }
  } else {
    const legacyOverview = hydrateDashboardLayoutConfig(
      layoutConfig,
      'overview'
    );
    if (legacyOverview) next.overview = legacyOverview;
  }

  next[category] = layouts;
  return next;
}
