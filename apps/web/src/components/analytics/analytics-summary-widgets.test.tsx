import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  AnalyticsSummaryWidgets,
  EMPTY_ANALYTICS_SUMMARY,
} from './analytics-summary-widgets';

describe('AnalyticsSummaryWidgets', () => {
  it('renders only visible summary metrics', () => {
    render(
      <AnalyticsSummaryWidgets
        formatCurrency={(value) => `$${value}`}
        formatPercent={(value) => `${value}%`}
        isWidgetVisible={(id) => id === 'summary-units'}
        summary={{ ...EMPTY_ANALYTICS_SUMMARY, totalUnitsSold: 7 }}
      />
    );

    expect(screen.getByText('Units Sold 🛒')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.queryByText('Total Revenue 💰')).not.toBeInTheDocument();
  });
});
