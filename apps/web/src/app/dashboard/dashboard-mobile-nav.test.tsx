import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

vi.mock('@/components/notifications/notification-center', () => ({
  NotificationCenter: () => null,
}));

import { DashboardMobileNav } from './dashboard-mobile-nav';
import {
  buildDashboardNavItems,
  type DashboardNavItem,
  filterDashboardNavItems,
} from './dashboard-nav';

const ownerItems: DashboardNavItem[] = filterDashboardNavItems(
  buildDashboardNavItems(0),
  {
    merchant: { slug: 'acme', business_type: 'electronics' },
    agenticMerchantSlug: null,
    staffAccess: { isStaff: false, isOwner: true, role: null, permissions: {} },
    hasPermission: () => true,
  }
);

function setup(
  overrides: Partial<React.ComponentProps<typeof DashboardMobileNav>> = {}
) {
  const onSheetOpenChange = vi.fn();
  const onNavItemClick = vi.fn();
  const onSignOut = vi.fn();
  render(
    <DashboardMobileNav
      pathname="/dashboard"
      isSheetOpen
      onSheetOpenChange={onSheetOpenChange}
      items={ownerItems}
      smartItems={[]}
      userEmail="owner@acme.com"
      onNavItemClick={onNavItemClick}
      onSignOut={onSignOut}
      {...overrides}
    />
  );
  return { onSheetOpenChange, onNavItemClick, onSignOut };
}

describe('DashboardMobileNav', () => {
  it('renders the nav tree inside the open sheet', () => {
    setup();

    const nav = screen.getByRole('navigation', { name: 'Main navigation' });
    expect(nav).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Products' })).toBeInTheDocument();
    // Nested children render under their parent.
    expect(
      screen.getByRole('link', { name: 'Discount Codes' })
    ).toBeInTheDocument();
  });

  it('renders smart shortcuts only when present', () => {
    const [first] = ownerItems;
    setup({ smartItems: [first] });

    expect(
      screen.getByRole('navigation', { name: 'Smart shortcuts' })
    ).toBeInTheDocument();
  });

  it('hides the smart shortcuts section when empty', () => {
    setup();

    expect(
      screen.queryByRole('navigation', { name: 'Smart shortcuts' })
    ).not.toBeInTheDocument();
  });

  it('records the tap and closes the sheet on navigation', () => {
    const { onNavItemClick, onSheetOpenChange } = setup();

    fireEvent.click(screen.getByRole('link', { name: 'Products' }));

    expect(onNavItemClick).toHaveBeenCalledWith('products');
    expect(onSheetOpenChange).toHaveBeenCalledWith(false);
  });

  it('signs out from the mobile user menu', async () => {
    const user = userEvent.setup();
    // The user menu lives in the header; keep the sheet closed so the
    // modal dialog does not hide it from the accessibility tree.
    const { onSignOut } = setup({ isSheetOpen: false });

    await user.click(screen.getByRole('button', { name: 'User menu' }));
    await user.click(screen.getByRole('menuitem', { name: 'Logout' }));

    expect(onSignOut).toHaveBeenCalledTimes(1);
  });
});
