import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  ReactNode,
} from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { platformAdminRolePermissions } from '@/config/platform-admin-rbac';

const mockPush = vi.fn();
const mockRefresh = vi.fn();
const mockSignOut = vi.fn();

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/admin/merchants',
  useRouter: () => ({
    push: mockPush,
    refresh: mockRefresh,
  }),
}));

vi.mock('@/components/logo', () => ({
  Logo: () => <span>Logo</span>,
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    type,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type={type ?? 'button'} {...props}>
      {children}
    </button>
  ),
}));

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuItem: ({
    children,
    onClick,
  }: {
    children: ReactNode;
    onClick?: () => void;
  }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
  DropdownMenuLabel: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock('@/components/ui/sheet', () => ({
  Sheet: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SheetContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  SheetTrigger: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TooltipContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  TooltipProvider: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  TooltipTrigger: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      signOut: mockSignOut,
    },
  }),
}));

import { AdminShell } from './admin-shell';

const ownerContext = {
  permissions: [...platformAdminRolePermissions.owner],
  role: 'owner' as const,
};

describe('AdminShell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSignOut.mockResolvedValue({ error: null });
  });

  it('renders admin navigation, account identity, and page content', () => {
    render(
      <AdminShell adminContext={ownerContext} adminEmail="admin@example.com">
        <div>Merchant operations</div>
      </AdminShell>
    );

    const adminNavigation = screen.getByRole('navigation', {
      name: 'Admin navigation',
    });

    expect(adminNavigation).toBeInTheDocument();
    expect(
      within(adminNavigation).getByRole('link', { name: /Merchants/i })
    ).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText('admin@example.com')).toBeInTheDocument();
    expect(screen.getByText('owner')).toBeInTheDocument();
    expect(screen.getByText('Merchant operations')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /Skip to main content/i })
    ).toHaveAttribute('href', '#main-content');
  });

  it('signs out through Supabase and returns to login', async () => {
    render(
      <AdminShell adminContext={ownerContext} adminEmail="admin@example.com">
        <div>Merchant operations</div>
      </AdminShell>
    );

    fireEvent.click(screen.getByRole('button', { name: /Logout/i }));

    await waitFor(() => {
      expect(mockSignOut).toHaveBeenCalledOnce();
    });
    expect(mockPush).toHaveBeenCalledWith('/login');
    expect(mockRefresh).toHaveBeenCalledOnce();
  });

  it('routes eligible admins to platform settings instead of merchant settings', () => {
    render(
      <AdminShell adminContext={ownerContext} adminEmail="admin@example.com">
        <div>Merchant operations</div>
      </AdminShell>
    );

    fireEvent.click(screen.getByRole('button', { name: /Platform Settings/i }));

    expect(mockPush).toHaveBeenCalledWith('/admin/settings');
    expect(mockPush).not.toHaveBeenCalledWith('/dashboard/settings');
  });

  it('hides navigation the current role is not permitted to use', () => {
    render(
      <AdminShell
        adminContext={{
          permissions: [...platformAdminRolePermissions.viewer],
          role: 'viewer',
        }}
        adminEmail="viewer@example.com"
      >
        <div>Read-only operations</div>
      </AdminShell>
    );

    const adminNavigation = screen.getByRole('navigation', {
      name: 'Admin navigation',
    });

    expect(
      within(adminNavigation).getByRole('link', { name: /Analytics/i })
    ).toBeInTheDocument();
    expect(
      within(adminNavigation).queryByRole('link', { name: /Access/i })
    ).not.toBeInTheDocument();
    expect(
      within(adminNavigation).queryByRole('link', {
        name: /Reconciliation/i,
      })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Platform Settings/i })
    ).not.toBeInTheDocument();
  });

  it('routes the brand link to the first page permitted for content-only admins', () => {
    render(
      <AdminShell
        adminContext={{ permissions: ['content.manage'], role: 'content' }}
        adminEmail="content@example.com"
      >
        <div>Content operations</div>
      </AdminShell>
    );

    expect(screen.getAllByRole('link', { name: /Logo/i })[0]).toHaveAttribute(
      'href',
      '/admin/blog'
    );
  });
});
