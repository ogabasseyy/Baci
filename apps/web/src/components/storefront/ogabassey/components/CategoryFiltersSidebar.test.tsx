import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  CategoryFiltersSidebar,
  type FilterState,
} from './CategoryFiltersSidebar';

const defaultFilters: FilterState = {
  brand: [],
  condition: [],
  storage: [],
  ram: [],
  graphics: [],
  colors: [],
  simType: [],
  displayType: [],
  displaySize: [],
  minPrice: 0,
  maxPrice: 10_000_000,
};

const defaultAvailableOptions = {
  brand: [],
  condition: [],
  storage: [],
  ram: [],
  graphics: [],
  colors: [],
  simType: [],
  displayType: [],
  displaySize: [],
};

describe('CategoryFiltersSidebar', () => {
  it('renders graphics-card options and reports the selected value', () => {
    const onFilterChange = vi.fn();

    render(
      <CategoryFiltersSidebar
        availableOptions={{
          ...defaultAvailableOptions,
          graphics: ['Integrated Graphics', 'NVIDIA RTX 4070'],
        }}
        filters={defaultFilters}
        onClearFilters={vi.fn()}
        onFilterChange={onFilterChange}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Graphics Card' }));
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'NVIDIA RTX 4070' })
    );

    expect(onFilterChange).toHaveBeenCalledWith('graphics', 'NVIDIA RTX 4070');
  });
});
