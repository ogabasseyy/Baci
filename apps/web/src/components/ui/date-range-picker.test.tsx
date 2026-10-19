import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const datePickerProps = vi.hoisted(() => vi.fn());
vi.mock('react-datepicker', () => ({
  default: (props: Record<string, unknown>) => {
    datePickerProps(props);
    return <div data-testid="date-picker" />;
  },
}));

import { DateRangePicker } from './date-range-picker';

describe('DateRangePicker', () => {
  it('disables dates beyond the configured inclusive reporting window', () => {
    render(
      <DateRangePicker
        date={{ from: new Date(2024, 0, 1), to: undefined }}
        maxRangeDays={366}
        setDate={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole('button'));

    expect(datePickerProps).toHaveBeenCalledWith(
      expect.objectContaining({ maxDate: new Date(2024, 11, 31) })
    );
  });

  it('allows a completed range to be restarted from any calendar date', () => {
    datePickerProps.mockClear();
    render(
      <DateRangePicker
        date={{ from: new Date(2024, 0, 1), to: new Date(2024, 0, 31) }}
        maxRangeDays={366}
        setDate={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole('button'));

    expect(datePickerProps).toHaveBeenCalledWith(
      expect.objectContaining({ maxDate: undefined })
    );
  });
});
