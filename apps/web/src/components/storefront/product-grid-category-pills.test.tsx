import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ProductGridCategoryPills } from './product-grid-category-pills';

describe('ProductGridCategoryPills', () => {
  it('renders nothing for a single category', () => {
    const { container } = render(
      <ProductGridCategoryPills
        categories={['All']}
        selectedCategory="All"
        onSelectCategory={() => undefined}
      />
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('marks the selected category pressed and selects on click', () => {
    const onSelectCategory = vi.fn();
    render(
      <ProductGridCategoryPills
        categories={['All', 'Phones', 'Laptops']}
        selectedCategory="Phones"
        onSelectCategory={onSelectCategory}
      />
    );

    expect(screen.getByRole('button', { name: 'Phones' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute(
      'aria-pressed',
      'false'
    );

    fireEvent.click(screen.getByRole('button', { name: 'Laptops' }));
    expect(onSelectCategory).toHaveBeenCalledWith('Laptops');
  });
});
