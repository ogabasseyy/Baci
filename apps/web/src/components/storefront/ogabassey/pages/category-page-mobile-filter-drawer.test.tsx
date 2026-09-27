import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../components/CategoryFiltersSidebar', () => ({
  CategoryFiltersSidebar: () => <div aria-label="Filters sidebar" />,
}));

import { CategoryPageMobileFilterDrawer } from './category-page-mobile-filter-drawer';

function renderDrawer(
  overrides: Partial<
    React.ComponentProps<typeof CategoryPageMobileFilterDrawer>
  > = {}
) {
  const onClose = vi.fn();

  render(
    <CategoryPageMobileFilterDrawer
      filters={{} as never}
      availableOptions={{} as never}
      onFilterChange={vi.fn()}
      onClearFilters={vi.fn()}
      onClose={onClose}
      paginationProductCount={7}
      showPriceFilter={true}
      {...overrides}
    />
  );

  return { onClose };
}

describe('CategoryPageMobileFilterDrawer', () => {
  it('renders the dialog with the filter sidebar and results count button', () => {
    renderDrawer();

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText('Filters sidebar')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Show 7 Results' })
    ).toBeInTheDocument();
  });

  it('invokes onClose from the backdrop, the header close, and the results button', () => {
    const { onClose } = renderDrawer();

    for (const button of screen.getAllByRole('button', { name: /close filters/i })) {
      fireEvent.click(button);
    }
    fireEvent.click(screen.getByRole('button', { name: 'Show 7 Results' }));

    expect(onClose).toHaveBeenCalledTimes(3);
  });
});
