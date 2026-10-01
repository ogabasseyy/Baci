import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BarChart3, LayoutDashboard, ShoppingCart } from 'lucide-react';
import type React from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { DashboardNavItem } from './client-layout';
import { DashboardNavCapsule } from './dashboard-nav-capsule';

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...props
  }: { children: React.ReactNode; href: string } & Record<string, unknown>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const items: DashboardNavItem[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    href: '/dashboard',
    icon: LayoutDashboard,
  },
  {
    id: 'analytics',
    label: 'Analytics',
    href: '/dashboard/analytics',
    icon: BarChart3,
  },
  {
    id: 'orders',
    label: 'Orders',
    href: '/dashboard/orders',
    icon: ShoppingCart,
    badge: 123,
  },
  {
    id: 'marketing',
    label: 'Marketing',
    href: '/dashboard/marketing',
    icon: BarChart3,
    children: [
      {
        id: 'discount-codes',
        label: 'Discount Codes',
        href: '/dashboard/marketing/discount-codes',
        icon: BarChart3,
      },
    ],
  },
];

describe('DashboardNavCapsule', () => {
  it('announces badge count and exact active page', () => {
    render(
      <DashboardNavCapsule
        expanded
        pathname="/dashboard/marketing/discount-codes"
        items={items}
        onExpandedChange={vi.fn()}
        onNavigate={vi.fn()}
      />
    );
    expect(
      screen.getByRole('link', { name: 'Orders, 99+' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Discount Codes' })
    ).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Marketing' })).not.toHaveAttribute(
      'aria-current'
    );
  });

  it('dismisses expanded state from Escape and outside pointer interaction', async () => {
    const user = userEvent.setup();
    const onExpandedChange = vi.fn();
    render(
      <DashboardNavCapsule
        expanded
        items={items}
        pathname="/dashboard"
        onExpandedChange={onExpandedChange}
        onNavigate={vi.fn()}
      />
    );
    await user.keyboard('{Escape}');
    expect(onExpandedChange).toHaveBeenCalledWith(false);
    onExpandedChange.mockClear();
    await user.click(document.body);
    expect(onExpandedChange).toHaveBeenCalledWith(false);
  });
});
