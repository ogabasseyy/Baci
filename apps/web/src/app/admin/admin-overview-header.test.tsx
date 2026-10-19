import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AdminOverviewHeader } from './admin-overview-header';

describe('AdminOverviewHeader', () => {
  it('changes period and refreshes when controls are available', async () => {
    const user = userEvent.setup();
    const onPeriodChange = vi.fn();
    const onRefresh = vi.fn();
    render(
      <AdminOverviewHeader
        loading={false}
        onPeriodChange={onPeriodChange}
        onRefresh={onRefresh}
        period="7d"
        refreshing={false}
      />
    );

    await user.click(screen.getByRole('button', { name: '30 Days' }));
    await user.click(screen.getByRole('button', { name: 'Refresh' }));

    expect(onPeriodChange).toHaveBeenCalledWith('30d');
    expect(onRefresh).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: '7 Days' })).toHaveClass(
      'bg-primary'
    );
  });

  it('disables period and refresh actions during a pending request', () => {
    render(
      <AdminOverviewHeader
        loading={false}
        onPeriodChange={vi.fn()}
        onRefresh={vi.fn()}
        period="all"
        refreshing
      />
    );

    expect(screen.getByRole('button', { name: 'All' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled();
  });
});
