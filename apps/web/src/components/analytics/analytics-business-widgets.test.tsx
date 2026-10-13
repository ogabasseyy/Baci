import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AnalyticsBusinessWidgets } from './analytics-business-widgets';
import { EMPTY_ANALYTICS_SUMMARY } from './analytics-summary-widgets';

describe('AnalyticsBusinessWidgets', () => {
  it('renders API-backed highlights instead of placeholders', () => {
    render(
      <AnalyticsBusinessWidgets
        data={{ topBrand: { name: 'Baci', value: 400, revenue: 400 } }}
        formatCurrency={(value) => `$${value}`}
        isWidgetVisible={(id) => id === 'analytics-highlights'}
        summary={EMPTY_ANALYTICS_SUMMARY}
      />
    );

    expect(screen.getByText('Baci')).toBeInTheDocument();
    expect(screen.getByText('$400')).toBeInTheDocument();
  });
});
