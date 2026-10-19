import { fireEvent, render, screen } from '@testing-library/react';
import type React from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    onClick,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
    onClick?: (event: unknown) => void;
  } & Record<string, unknown>) => (
    <a
      href={href}
      onClick={(event) => {
        event.preventDefault();
        onClick?.(event);
      }}
      {...props}
    >
      {children}
    </a>
  ),
}));

import { DashboardMobileBottomNav } from './dashboard-mobile-bottom-nav';

function setup(
  overrides: Partial<React.ComponentProps<typeof DashboardMobileBottomNav>> = {}
) {
  const onNavItemClick = vi.fn();
  const onMenuClick = vi.fn();
  render(
    <DashboardMobileBottomNav
      pathname="/dashboard"
      ordersCount={0}
      onNavItemClick={onNavItemClick}
      onMenuClick={onMenuClick}
      {...overrides}
    />
  );
  return { onNavItemClick, onMenuClick };
}

describe('DashboardMobileBottomNav', () => {
  it('renders the four tabs and links them at the dashboard paths', () => {
    setup();

    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute(
      'href',
      '/dashboard'
    );
    expect(screen.getByRole('link', { name: 'Orders' })).toHaveAttribute(
      'href',
      '/dashboard/orders'
    );
    expect(screen.getByRole('link', { name: 'Products' })).toHaveAttribute(
      'href',
      '/dashboard/products'
    );
    expect(screen.getByRole('link', { name: 'Customers' })).toHaveAttribute(
      'href',
      '/dashboard/customers'
    );
  });

  it('shows the orders badge only when the count is positive', () => {
    const { unmount } = render(
      <DashboardMobileBottomNav
        pathname="/dashboard"
        ordersCount={3}
        onNavItemClick={vi.fn()}
        onMenuClick={vi.fn()}
      />
    );
    expect(screen.getByText('3')).toBeInTheDocument();
    unmount();

    setup();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('records tab taps and opens the menu sheet', () => {
    const { onNavItemClick, onMenuClick } = setup();

    fireEvent.click(screen.getByRole('link', { name: 'Orders' }));
    expect(onNavItemClick).toHaveBeenCalledWith('orders');

    fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
    expect(onMenuClick).toHaveBeenCalledTimes(1);
  });
});
