import { render } from '@testing-library/react';
import { useEffect } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const insightLifecycle = vi.hoisted(() => ({ mounts: 0, unmounts: 0 }));

vi.mock('./ai-insights-panel', () => ({
  AIInsightsPanel: () => {
    useEffect(() => {
      insightLifecycle.mounts += 1;
      return () => {
        insightLifecycle.unmounts += 1;
      };
    }, []);
    return <div data-testid="analytics-insights" />;
  },
}));

vi.mock('./analytics-grid-view-mode', () => ({
  AnalyticsGridViewMode: () => <div data-testid="analytics-view" />,
}));
vi.mock('./analytics-grid-edit-mode', () => ({
  AnalyticsGridEditMode: () => <div data-testid="analytics-edit" />,
}));
vi.mock('./analytics-grid-formatters', () => ({
  createAnalyticsFormatters: () => ({
    formatCurrency: String,
    formatPercent: String,
  }),
}));
vi.mock('./use-analytics-grid-layout', () => ({
  useAnalyticsGridLayout: () => ({ layouts: {}, onLayoutChange: vi.fn() }),
}));

import { DraggableAnalyticsGrid } from './draggable-analytics-grid';

describe('DraggableAnalyticsGrid', () => {
  beforeEach(() => {
    insightLifecycle.mounts = 0;
    insightLifecycle.unmounts = 0;
  });

  it('keeps AI insights mounted while category data transitions from loading', () => {
    const props = {
      activeCategory: 'inventory' as const,
      canCustomizeLayout: false,
      canManageAdsIntegrations: false,
      data: {},
      loading: true,
      merchant: null,
    };
    const view = render(<DraggableAnalyticsGrid {...props} />);

    expect(insightLifecycle.mounts).toBe(1);

    view.rerender(<DraggableAnalyticsGrid {...props} loading={false} />);

    expect(insightLifecycle.mounts).toBe(1);
    expect(insightLifecycle.unmounts).toBe(0);

    view.unmount();
    expect(insightLifecycle.unmounts).toBe(1);
  });
});
