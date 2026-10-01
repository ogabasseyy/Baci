import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AnalyticsGridEditMode } from './analytics-grid-edit-mode';
import { resolveCategoryLayouts } from './analytics-grid-layouts';

vi.mock('react-grid-layout/legacy', () => ({
  Responsive: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="responsive-grid">{children}</div>
  ),
  WidthProvider: (component: unknown) => component,
}));
vi.mock('./ai-insights-panel', () => ({
  AIInsightsPanel: () => <div>Insights</div>,
}));
vi.mock('./analytics-summary-widgets', () => ({
  AnalyticsSummaryWidgets: () => <div key="summary">Summary</div>,
}));
vi.mock('./analytics-business-widgets', () => ({
  AnalyticsBusinessWidgets: () => <div key="business">Business</div>,
}));
vi.mock('./analytics-sales-widgets', () => ({
  AnalyticsSalesWidgets: () => <div key="sales">Sales</div>,
}));
vi.mock('./analytics-inventory-widgets', () => ({
  AnalyticsInventoryWidgets: () => <div key="inventory">Inventory</div>,
}));
vi.mock('./analytics-segment-widgets', () => ({
  AnalyticsSegmentWidgets: () => <div key="segments">Segments</div>,
}));
vi.mock('./analytics-detail-widget-group', () => ({
  AnalyticsDetailWidgetGroup: () => <div key="details">Details</div>,
}));
vi.mock('./ads-analytics-widgets', () => ({
  renderAdsAnalyticsWidgets: () => null,
}));

describe('AnalyticsGridEditMode', () => {
  it('flattens extracted widgets into the draggable grid and exits on save', () => {
    const onSave = vi.fn();
    render(
      <AnalyticsGridEditMode
        activeCategory="overview"
        canManageAdsIntegrations={false}
        data={{}}
        formatCurrency={String}
        formatPercent={String}
        isWidgetVisible={() => true}
        layouts={resolveCategoryLayouts('overview')}
        merchant={null}
        onLayoutChange={() => undefined}
        onSave={onSave}
        summary={{
          activeNow: { change: 0, value: 0 },
          customers: { change: 0, value: 0 },
          revenue: { change: 0, value: 0 },
          sales: { change: 0, value: 0 },
        }}
      />
    );

    expect(screen.getByTestId('responsive-grid')).toHaveTextContent(
      'SummaryBusinessDetailsSalesInventorySegments'
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Save Dashboard Layout' })
    );
    expect(onSave).toHaveBeenCalledOnce();
  });
});
