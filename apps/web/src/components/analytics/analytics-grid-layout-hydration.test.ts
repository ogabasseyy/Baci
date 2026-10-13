import { describe, expect, it } from 'vitest';
import {
  hydrateDashboardLayoutConfig,
  mergeDashboardLayoutConfig,
} from './analytics-grid-layout-hydration';
import {
  ANALYTICS_WIDGET_IDS_BY_CATEGORY,
  getAnalyticsLayoutWidgetIds,
  resolveCategoryLayouts,
} from './analytics-grid-layouts';

describe('hydrateDashboardLayoutConfig', () => {
  it('hydrates legacy arrays into the desktop layout and keeps category defaults', () => {
    const hydrated = hydrateDashboardLayoutConfig(
      [
        { i: 'summary-revenue', x: 7, y: 4, w: 4, h: 1 },
        { i: 'not-visible-in-finance', x: 0, y: 0, w: 2, h: 1 },
      ],
      'finance'
    );
    if (!hydrated) throw new Error('Expected finance layout to hydrate');

    expect(
      hydrated.lg.find((item) => item.i === 'summary-revenue')
    ).toMatchObject({
      x: 7,
      y: 4,
    });
    expect(hydrated.md.map((item) => item.i)).toEqual(
      expect.arrayContaining(
        Array.from(ANALYTICS_WIDGET_IDS_BY_CATEGORY.finance)
      )
    );
    expect(hydrated.lg.map((item) => item.i)).not.toContain(
      'not-visible-in-finance'
    );
  });

  it('hydrates responsive layouts while ignoring malformed and hidden items', () => {
    const hydrated = hydrateDashboardLayoutConfig(
      {
        lg: [
          { i: 'analytics-highlights', x: 2, y: 9, w: 8, h: 2 },
          { i: 'summary-units', x: 'bad', y: 1, w: 2, h: 1 },
          { i: 'summary-revenue', x: 0, y: 0, w: 4, h: 1 },
        ],
      },
      'overview'
    );
    if (!hydrated) throw new Error('Expected overview layout to hydrate');

    expect(
      hydrated.lg.find((item) => item.i === 'analytics-highlights')
    ).toMatchObject({
      x: 2,
      y: 9,
    });
    expect(hydrated.lg.map((item) => item.i)).toEqual(
      expect.arrayContaining(getAnalyticsLayoutWidgetIds('overview', 'lg'))
    );
    expect(
      hydrated.lg.find((item) => item.i === 'summary-units')
    ).toMatchObject({
      x: 0,
      y: 12,
    });
  });

  it('returns null for an empty or invalid persisted config', () => {
    expect(hydrateDashboardLayoutConfig([], 'overview')).toBeNull();
    expect(
      hydrateDashboardLayoutConfig({ lg: 'invalid' }, 'overview')
    ).toBeNull();
    expect(hydrateDashboardLayoutConfig(null, 'overview')).toBeNull();
  });

  it('hydrates a category map and updates only the active category', () => {
    const finance = hydrateDashboardLayoutConfig(
      {
        lg: [{ i: 'summary-revenue', x: 6, y: 2, w: 4, h: 1 }],
      },
      'finance'
    );
    if (!finance) throw new Error('Expected finance layout to hydrate');
    const ads = hydrateDashboardLayoutConfig(
      { lg: [{ i: 'ads-reporting', x: 3, y: 5, w: 6, h: 3 }] },
      'ads'
    );
    if (!ads) throw new Error('Expected ads layout to hydrate');

    const next = mergeDashboardLayoutConfig(
      { ads, finance },
      'finance',
      finance
    );

    expect(next).toMatchObject({ ads, finance });
    expect(hydrateDashboardLayoutConfig(next, 'ads')).toEqual(ads);
  });

  it('preserves a legacy overview layout when another category is first edited', () => {
    const next = mergeDashboardLayoutConfig(
      [{ i: 'analytics-highlights', x: 4, y: 2, w: 8, h: 2 }],
      'ads',
      resolveCategoryLayouts('ads')
    );

    expect(hydrateDashboardLayoutConfig(next, 'overview')).not.toBeNull();
    expect(hydrateDashboardLayoutConfig(next, 'ads')).not.toBeNull();
  });
});
