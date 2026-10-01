import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AnalyticsSegmentWidgets } from './analytics-segment-widgets';

describe('AnalyticsSegmentWidgets', () => {
  it('labels and formats champion segment revenue', () => {
    render(
      <AnalyticsSegmentWidgets
        data={{
          segmentSummary: {
            at_risk_count: 0,
            champions_count: 1,
            total_customers: 1,
            segments: [{ segment: 'Champions', count: 1, total_revenue: 800 }],
          },
        }}
        formatCurrency={(value) => `$${value}`}
        isWidgetVisible={(id) => id === 'champions-list'}
      />
    );

    expect(screen.getByText('Segment Revenue')).toBeInTheDocument();
    expect(screen.getByText('$800')).toBeInTheDocument();
  });

  it('shows the aggregate CLV for all at-risk segments', () => {
    render(
      <AnalyticsSegmentWidgets
        data={{
          segmentSummary: {
            at_risk_avg_clv: 65,
            at_risk_count: 4,
            champions_count: 0,
            total_customers: 4,
            segments: [
              { avg_clv: 80, count: 3, segment: 'At Risk' },
              { avg_clv: 20, count: 1, segment: "Can't Lose Them" },
            ],
          },
        }}
        formatCurrency={(value) => `$${value}`}
        isWidgetVisible={(id) => id === 'at-risk-customers'}
      />
    );

    expect(screen.getByText('$65')).toBeInTheDocument();
    expect(screen.queryByText('$80')).not.toBeInTheDocument();
  });
});
