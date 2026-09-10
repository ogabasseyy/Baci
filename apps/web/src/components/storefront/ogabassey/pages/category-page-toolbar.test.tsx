import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('@/lib/routes', () => ({ asRoute: (p: string) => p }));

import { CategoryPageToolbar } from './category-page-toolbar';

function renderToolbar(
  overrides: Partial<
    React.ComponentProps<typeof CategoryPageToolbar>
  > = {}
) {
  const onViewModeChange = vi.fn();
  const onOpenMobileFilter = vi.fn();

  render(
    <CategoryPageToolbar
      basePath="/test-store"
      displayTitle="Smartphones"
      paginationProductCount={42}
      viewMode="grid"
      onViewModeChange={onViewModeChange}
      canUseClientFilters={true}
      onOpenMobileFilter={onOpenMobileFilter}
      {...overrides}
    />
  );

  return { onViewModeChange, onOpenMobileFilter };
}

describe('CategoryPageToolbar', () => {
  it('renders the heading, breadcrumb and results count', () => {
    renderToolbar();

    expect(
      screen.getByRole('heading', { name: 'Smartphones', level: 1 })
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute(
      'href',
      '/test-store'
    );
    expect(screen.getByText('42 results found')).toBeInTheDocument();
  });

  it('invokes onViewModeChange when a view mode button is clicked', () => {
    const { onViewModeChange } = renderToolbar();

    const [gridButton, listButton] = screen.getAllByRole('button');
    fireEvent.click(listButton);
    expect(onViewModeChange).toHaveBeenCalledWith('list');

    fireEvent.click(gridButton);
    expect(onViewModeChange).toHaveBeenCalledWith('grid');
  });

  it('shows the mobile filter trigger only when client filters are enabled', () => {
    const { onOpenMobileFilter } = renderToolbar();

    const filterButton = screen.getByRole('button', { name: /filters/i });
    fireEvent.click(filterButton);
    expect(onOpenMobileFilter).toHaveBeenCalledTimes(1);
  });

  it('hides the mobile filter trigger when client filters are disabled', () => {
    renderToolbar({ canUseClientFilters: false });

    expect(
      screen.queryByRole('button', { name: /filters/i })
    ).not.toBeInTheDocument();
  });

  it('demotes the heading when a parent route already owns the page H1', () => {
    renderToolbar({ titleHeading: 'h2' });

    expect(
      screen.getByRole('heading', { name: 'Smartphones', level: 2 })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Smartphones', level: 1 })
    ).not.toBeInTheDocument();
  });
});
