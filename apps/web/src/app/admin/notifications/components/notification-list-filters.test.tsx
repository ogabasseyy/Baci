import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NotificationListFilters } from './notification-list-filters';

describe('NotificationListFilters', () => {
  it('keeps search input controlled and refreshes without changing filters', () => {
    const onFiltersChange = vi.fn();
    const onRefresh = vi.fn();
    const onSearchChange = vi.fn();
    render(
      <NotificationListFilters
        filters={{ priority: 'high', type: 'warning' }}
        onFiltersChange={onFiltersChange}
        onRefresh={onRefresh}
        onSearchChange={onSearchChange}
        searchQuery="maintenance"
      />
    );

    const search = screen.getByPlaceholderText('Search notifications...');
    expect(search).toHaveValue('maintenance');
    fireEvent.change(search, { target: { value: 'payment' } });
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));

    expect(onSearchChange).toHaveBeenCalledWith('payment');
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onFiltersChange).not.toHaveBeenCalled();
  });
});
