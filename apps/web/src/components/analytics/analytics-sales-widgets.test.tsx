import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AnalyticsSalesWidgets } from './analytics-sales-widgets';

vi.mock('./chart-components', () => ({
  RevenueChart: () => <div>Revenue chart</div>,
  SalesByChannelChart: () => <div>Channel chart</div>,
}));

describe('AnalyticsSalesWidgets', () => {
  it('renders real unit counts for top products', () => {
    render(
      <AnalyticsSalesWidgets
        data={{
          topProducts: [{ id: '1', name: 'Phone', revenue: 500, units: 3 }],
        }}
        editMode
        formatCurrency={(value) => `$${value}`}
        isWidgetVisible={(id) => id === 'top-products'}
      />
    );

    expect(screen.getByText('3 units sold')).toBeInTheDocument();
    expect(screen.getByText('$500')).toBeInTheDocument();
  });
});
