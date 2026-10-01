import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/ui/select', () => ({
  Select: ({
    children,
    disabled,
    onValueChange,
  }: {
    children?: ReactNode;
    disabled?: boolean;
    onValueChange: (value: string) => void;
  }) => (
    <div data-disabled={disabled}>
      <button
        disabled={disabled}
        onClick={() => onValueChange('90d')}
        type="button"
      >
        Choose 90 days
      </button>
      {children}
    </div>
  ),
  SelectContent: ({ children }: { children?: ReactNode }) => <>{children}</>,
  SelectItem: ({ children }: { children?: ReactNode }) => <>{children}</>,
  SelectTrigger: ({ children }: { children?: ReactNode }) => <>{children}</>,
  SelectValue: () => null,
}));

import { AnalyticsHeader } from './analytics-header';

describe('AnalyticsHeader', () => {
  it('forwards a selected reporting period and refresh action', async () => {
    const user = userEvent.setup();
    const onPeriodChange = vi.fn();
    const onRefresh = vi.fn();
    render(
      <AnalyticsHeader
        loading={false}
        onPeriodChange={onPeriodChange}
        onRefresh={onRefresh}
        period="30d"
      />
    );

    await user.click(screen.getByRole('button', { name: 'Choose 90 days' }));
    await user.click(screen.getByRole('button', { name: 'Refresh' }));

    expect(onPeriodChange).toHaveBeenCalledWith('90d');
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it('prevents period changes and refreshes during loading', () => {
    render(
      <AnalyticsHeader
        loading
        onPeriodChange={vi.fn()}
        onRefresh={vi.fn()}
        period="7d"
      />
    );

    expect(
      screen.getByRole('button', { name: 'Choose 90 days' })
    ).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled();
  });
});
