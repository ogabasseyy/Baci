import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ProductGridFilters } from './product-grid-filters';

describe('ProductGridFilters', () => {
  it('selects an option and toggles it back to All', () => {
    const onSelectCategory = vi.fn();
    render(
      <ProductGridFilters
        filterType="category"
        filterOptions={['Phones', 'Laptops']}
        selectedCategory="All"
        onFilterTypeChange={() => undefined}
        onSelectCategory={onSelectCategory}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Phones' }));
    expect(onSelectCategory).toHaveBeenCalledWith('Phones');
  });

  it('resets to All when the filter type changes', () => {
    const onFilterTypeChange = vi.fn();
    const onSelectCategory = vi.fn();
    render(
      <ProductGridFilters
        filterType="category"
        filterOptions={['Phones']}
        selectedCategory="Phones"
        onFilterTypeChange={onFilterTypeChange}
        onSelectCategory={onSelectCategory}
      />
    );

    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: 'brand' },
    });
    expect(onFilterTypeChange).toHaveBeenCalledWith('brand');
    expect(onSelectCategory).toHaveBeenCalledWith('All');
  });

  it('shows the empty message when no options exist', () => {
    render(
      <ProductGridFilters
        filterType="brand"
        filterOptions={[]}
        selectedCategory="All"
        onFilterTypeChange={() => undefined}
        onSelectCategory={() => undefined}
      />
    );

    expect(screen.getByText(/No brands found/)).toBeInTheDocument();
  });
});
