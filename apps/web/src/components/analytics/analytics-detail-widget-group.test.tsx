import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AnalyticsDetailWidgetGroup } from './analytics-detail-widget-group';

vi.mock('./analytics-detail-widgets', () => ({
  AnalyticsDetailWidgets: ({ widgetId }: { widgetId: string }) => (
    <div>{widgetId}</div>
  ),
}));

describe('AnalyticsDetailWidgetGroup', () => {
  it('renders only detail widgets enabled for the category', () => {
    render(
      <AnalyticsDetailWidgetGroup
        data={{}}
        formatCurrency={String}
        isWidgetVisible={(id) => id === 'blog-performance'}
        viewMode
      />
    );

    expect(screen.getByText('blog-performance')).toBeInTheDocument();
    expect(screen.queryByText('orders-chart')).not.toBeInTheDocument();
  });
});
