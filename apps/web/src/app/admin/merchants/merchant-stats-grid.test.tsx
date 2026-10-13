import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { HealthFilter } from '@/app/admin/merchants/merchant-stats-grid';
import { MerchantStatsGrid } from '@/app/admin/merchants/merchant-stats-grid';

const stats = {
  atRisk: 1,
  churned: 0,
  healthy: 2,
  new: 3,
  total: 6,
};

describe('MerchantStatsGrid', () => {
  it('renders all stat cards with accessible button state', () => {
    render(
      <MerchantStatsGrid
        activeFilter="healthy"
        onFilterChange={vi.fn()}
        stats={stats}
      />
    );

    for (const [label, value] of [
      ['Total Merchants', '6'],
      ['Selling', '2'],
      ['Sales Quiet', '1'],
      ['Sales Dormant', '0'],
      ['No Paid Sales Since Launch', '3'],
    ] as const) {
      const card = screen.getByRole('button', {
        name: `Filter merchants by ${label}`,
      });
      expect(card).toBeVisible();
      expect(card).toHaveTextContent(value);
      expect(card).toHaveAttribute(
        'aria-pressed',
        label === 'Selling' ? 'true' : 'false'
      );
    }
  });

  it('activates each filter by click', async () => {
    const user = userEvent.setup();
    const onFilterChange = vi.fn();

    render(
      <MerchantStatsGrid
        activeFilter="all"
        onFilterChange={onFilterChange}
        stats={stats}
      />
    );

    for (const [label, filter] of [
      ['Total Merchants', 'all'],
      ['Selling', 'healthy'],
      ['Sales Quiet', 'at_risk'],
      ['Sales Dormant', 'churned'],
      ['No Paid Sales Since Launch', 'new'],
    ] as const) {
      await user.click(
        screen.getByRole('button', { name: `Filter merchants by ${label}` })
      );
      expect(onFilterChange).toHaveBeenLastCalledWith(filter);
    }

    expect(onFilterChange).toHaveBeenCalledTimes(5);
  });

  it('activates filters by keyboard', async () => {
    const user = userEvent.setup();
    const onFilterChange = vi.fn();

    render(
      <MerchantStatsGrid
        activeFilter="all"
        onFilterChange={onFilterChange}
        stats={stats}
      />
    );

    for (const [label, filter] of [
      ['Total Merchants', 'all'],
      ['Selling', 'healthy'],
      ['Sales Quiet', 'at_risk'],
      ['Sales Dormant', 'churned'],
      ['No Paid Sales Since Launch', 'new'],
    ] as const) {
      const card = screen.getByRole('button', {
        name: `Filter merchants by ${label}`,
      });
      card.focus();
      await user.keyboard('{Enter}');
      await user.keyboard(' ');

      expect(onFilterChange).toHaveBeenLastCalledWith(filter);
    }

    expect(onFilterChange).toHaveBeenCalledTimes(10);
    expect(onFilterChange.mock.calls.map(([filter]) => filter)).toEqual([
      'all',
      'all',
      'healthy',
      'healthy',
      'at_risk',
      'at_risk',
      'churned',
      'churned',
      'new',
      'new',
    ]);
  });

  it('renders unusual metric values without selecting invalid filters', () => {
    // Runtime guard coverage for values that bypass the HealthFilter type.
    const invalidFilter = 'invalid' as unknown as HealthFilter;

    render(
      <MerchantStatsGrid
        activeFilter={invalidFilter}
        onFilterChange={vi.fn()}
        stats={{
          atRisk: -1,
          churned: 1_000_000,
          healthy: 0,
          new: 99,
          total: 1_000_098,
        }}
      />
    );

    expect(screen.getByText('-1')).toBeVisible();
    expect(screen.getByText('1000000')).toBeVisible();
    expect(screen.getByText('1000098')).toBeVisible();
    for (const button of screen.getAllByRole('button')) {
      expect(button).toHaveAttribute('aria-pressed', 'false');
    }
  });
});
