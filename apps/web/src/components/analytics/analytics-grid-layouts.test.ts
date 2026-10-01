import { describe, expect, it } from 'vitest';

import {
  ANALYTICS_WIDGET_IDS_BY_CATEGORY,
  getAnalyticsLayoutWidgetIds,
} from './analytics-grid-layouts';

const BREAKPOINTS = ['lg', 'md', 'sm', 'xs', 'xxs'] as const;

describe('analytics grid layout contract', () => {
  it('keeps every visible widget in each category layout at every breakpoint', () => {
    for (const [category, visibleWidgetIds] of Object.entries(
      ANALYTICS_WIDGET_IDS_BY_CATEGORY
    )) {
      for (const breakpoint of BREAKPOINTS) {
        const layoutWidgetIds = getAnalyticsLayoutWidgetIds(
          category as keyof typeof ANALYTICS_WIDGET_IDS_BY_CATEGORY,
          breakpoint
        );

        expect(new Set(layoutWidgetIds)).toEqual(new Set(visibleWidgetIds));
        expect(layoutWidgetIds).toHaveLength(visibleWidgetIds.length);
      }
    }
  });

  it('keeps the previously view-only widgets editable', () => {
    const overviewLayout = new Set(
      getAnalyticsLayoutWidgetIds('overview', 'lg')
    );

    expect(overviewLayout.has('analytics-highlights')).toBe(true);
    expect(overviewLayout.has('financial-summary')).toBe(true);
    expect(overviewLayout.has('summary-units')).toBe(true);
  });

  it('keeps Google and social reporting independently placeable', () => {
    for (const breakpoint of BREAKPOINTS) {
      const adsLayout = getAnalyticsLayoutWidgetIds('ads', breakpoint);
      expect(adsLayout).toContain('ads-reporting');
      expect(adsLayout).toContain('social-ads-reporting');
    }
  });
});
