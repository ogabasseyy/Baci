import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { resolveCategoryLayouts } from './analytics-grid-layouts';
import { AnalyticsGridViewMode } from './analytics-grid-view-mode';
import { EMPTY_ANALYTICS_SUMMARY } from './analytics-summary-widgets';

vi.mock('react-grid-layout/legacy', () => ({
  Responsive: ({
    children,
    isDraggable,
    isResizable,
    layouts,
  }: {
    children: React.ReactNode;
    isDraggable?: boolean;
    isResizable?: boolean;
    layouts?: unknown;
  }) => (
    <div
      data-draggable={String(isDraggable)}
      data-layouts={JSON.stringify(layouts)}
      data-resizable={String(isResizable)}
      data-testid="responsive-grid"
    >
      {children}
    </div>
  ),
  WidthProvider: (component: unknown) => component,
}));

vi.mock('./ai-insights-panel', () => ({
  AIInsightsPanel: () => <div>Insights</div>,
}));
vi.mock('./analytics-summary-widgets', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  AnalyticsSummaryWidgets: () => <div>Summary</div>,
}));
vi.mock('./analytics-business-widgets', () => ({
  AnalyticsBusinessWidgets: () => <div>Business</div>,
}));
vi.mock('./analytics-sales-widgets', () => ({
  AnalyticsSalesWidgets: () => <div>Sales</div>,
}));
vi.mock('./analytics-inventory-widgets', () => ({
  AnalyticsInventoryWidgets: () => <div>Inventory</div>,
}));
vi.mock('./analytics-segment-widgets', () => ({
  AnalyticsSegmentWidgets: () => <div>Segments</div>,
}));
vi.mock('./analytics-detail-widget-group', () => ({
  AnalyticsDetailWidgetGroup: () => <div>Details</div>,
}));
vi.mock('./ads-analytics-widgets', () => ({
  renderAdsAnalyticsWidgets: () => null,
}));

const baseProps = {
  activeCategory: 'overview' as const,
  canManageAdsIntegrations: false,
  categoryError: null,
  data: {},
  formatCurrency: String,
  formatPercent: String,
  isWidgetVisible: () => false,
  layouts: resolveCategoryLayouts('overview'),
  merchant: null,
  onEdit: vi.fn(),
  summary: EMPTY_ANALYTICS_SUMMARY,
};

describe('AnalyticsGridViewMode', () => {
  it.each([
    { activeCategory: 'inventory' as const, label: 'Inventory' },
    { activeCategory: 'segments' as const, label: 'Segments' },
  ])('renders the $label widgets in normal view mode', ({
    activeCategory,
    label,
  }) => {
    render(
      <AnalyticsGridViewMode
        {...baseProps}
        activeCategory={activeCategory}
        canCustomizeLayout={false}
      />
    );

    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('hides layout customization without settings edit permission', () => {
    render(<AnalyticsGridViewMode {...baseProps} canCustomizeLayout={false} />);

    expect(
      screen.queryByRole('button', { name: 'Customize Dashboard Layout' })
    ).not.toBeInTheDocument();
  });

  it('allows an authorized merchant to enter edit mode', () => {
    const onEdit = vi.fn();
    render(
      <AnalyticsGridViewMode
        {...baseProps}
        canCustomizeLayout
        onEdit={onEdit}
      />
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Customize Dashboard Layout' })
    );
    expect(onEdit).toHaveBeenCalledOnce();
  });

  it('renders a retry action when analytics loading fails', () => {
    const onAnalyticsRetry = vi.fn();
    render(
      <AnalyticsGridViewMode
        {...baseProps}
        categoryError="Unable to load analytics. Please try again."
        canCustomizeLayout={false}
        onAnalyticsRetry={onAnalyticsRetry}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Retry analytics' }));
    expect(onAnalyticsRetry).toHaveBeenCalledOnce();
  });

  it('applies saved layouts in normal view without enabling editing', () => {
    const defaultLayouts = resolveCategoryLayouts('overview');
    const savedLayouts = {
      ...defaultLayouts,
      lg: defaultLayouts.lg.map((item) =>
        item.i === 'summary-revenue'
          ? { ...item, h: 2, w: 6, x: 6, y: 4 }
          : item
      ),
    };

    render(
      <AnalyticsGridViewMode
        {...baseProps}
        canCustomizeLayout={false}
        isWidgetVisible={() => true}
        layouts={savedLayouts}
      />
    );

    const grid = screen.getByTestId('responsive-grid');
    expect(grid).toHaveAttribute('data-draggable', 'false');
    expect(grid).toHaveAttribute('data-resizable', 'false');
    expect(grid).toHaveAttribute('data-layouts', JSON.stringify(savedLayouts));
  });
});
