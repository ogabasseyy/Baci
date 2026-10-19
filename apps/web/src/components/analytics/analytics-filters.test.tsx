import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const dateRangePickerProps = vi.hoisted(() => vi.fn());
vi.mock('@/components/ui/date-range-picker', () => ({
  DateRangePicker: (props: Record<string, unknown>) => {
    dateRangePickerProps(props);
    return null;
  },
}));

import { AnalyticsFilters } from './analytics-filters';

describe('AnalyticsFilters', () => {
  beforeEach(() => {
    dateRangePickerProps.mockClear();
  });

  it('applies the server reporting-range limit to the date picker', () => {
    render(
      <AnalyticsFilters
        category="ads"
        date={{ from: new Date(2024, 0, 1), to: new Date(2024, 0, 31) }}
        onDateChange={vi.fn()}
      />
    );

    expect(dateRangePickerProps).toHaveBeenCalledWith(
      expect.objectContaining({ maxRangeDays: 366 })
    );
  });

  it('does not apply the Ads range limit to non-Ads categories', () => {
    render(
      <AnalyticsFilters
        category="overview"
        date={{ from: new Date(2020, 0, 1), to: new Date(2024, 0, 31) }}
        onDateChange={vi.fn()}
      />
    );

    expect(dateRangePickerProps).toHaveBeenCalledWith(
      expect.objectContaining({ maxRangeDays: undefined })
    );
  });

  it('removes the date range control for lifetime segment metrics', () => {
    render(
      <AnalyticsFilters
        category="segments"
        date={{ from: new Date(2024, 0, 1), to: new Date(2024, 0, 31) }}
        onDateChange={vi.fn()}
      />
    );

    expect(dateRangePickerProps).not.toHaveBeenCalled();
    expect(screen.getByText('Segments show lifetime data')).toBeInTheDocument();
  });
});
