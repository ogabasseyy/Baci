import { render, screen } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { platformAdminRolePermissions } from '@/config/platform-admin-rbac';
import type { PlatformAdminContextAuth } from '@/lib/platform-admin-auth';

const mockGetPlatformAdminContextAuth =
  vi.fn<() => Promise<PlatformAdminContextAuth>>();
const mockRedirect = vi.fn((path: string): never => {
  throw new Error(`NEXT_REDIRECT:${path}`);
});

vi.mock('next/navigation', () => ({
  redirect: (path: string) => mockRedirect(path),
}));

vi.mock('@/app/app-sans-font', () => ({
  AppSansFont: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/csrf-initializer', () => ({
  CsrfInitializer: () => <div data-testid="csrf-initializer" />,
}));

vi.mock('@/lib/platform-admin-auth', () => ({
  getPlatformAdminContextAuth: () => mockGetPlatformAdminContextAuth(),
}));

vi.mock('./admin-shell', () => ({
  AdminShell: ({
    adminContext,
    adminEmail,
    children,
  }: {
    adminContext: { role: string };
    adminEmail: string | null;
    children: ReactNode;
  }) => (
    <section
      data-admin-email={adminEmail ?? ''}
      data-admin-role={adminContext.role}
      data-testid="admin-shell"
    >
      {children}
    </section>
  ),
}));

import AdminLayout, { AdminLayoutContent } from './layout';

describe('AdminLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPlatformAdminContextAuth.mockResolvedValue({
      context: {
        permissions: [...platformAdminRolePermissions.owner],
        role: 'owner',
      },
      status: 'authenticated',
      user: { email: 'admin@example.com', id: 'user-1' },
    });
  });

  it('renders the admin shell only after server-side admin authorization passes', async () => {
    const layout = await AdminLayoutContent({
      children: <div>Admin content</div>,
    });

    render(layout);

    expect(mockGetPlatformAdminContextAuth).toHaveBeenCalledOnce();
    expect(screen.getByTestId('csrf-initializer')).toBeInTheDocument();
    expect(screen.getByTestId('admin-shell')).toHaveAttribute(
      'data-admin-email',
      'admin@example.com'
    );
    expect(screen.getByTestId('admin-shell')).toHaveAttribute(
      'data-admin-role',
      'owner'
    );
    expect(screen.getByText('Admin content')).toBeInTheDocument();
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it('renders a local fallback while server-side admin authorization is pending', () => {
    mockGetPlatformAdminContextAuth.mockReturnValueOnce(
      new Promise(() => {
        // Intentionally unresolved to keep the Suspense fallback visible.
      })
    );

    const layout = AdminLayout({
      children: <div>Admin content</div>,
    });

    expect(layout).not.toBeInstanceOf(Promise);

    render(layout as ReactElement);

    expect(screen.getByRole('status')).toHaveTextContent(
      'Loading admin workspace'
    );
    expect(screen.queryByText('Admin content')).not.toBeInTheDocument();
  });

  it('redirects unauthenticated users back to login with the admin return path', async () => {
    mockGetPlatformAdminContextAuth.mockResolvedValue({
      status: 'unauthenticated',
    });

    await expect(
      AdminLayoutContent({
        children: <div>Admin content</div>,
      })
    ).rejects.toThrow('NEXT_REDIRECT:/login?redirect=%2Fadmin');

    expect(mockRedirect).toHaveBeenCalledWith('/login?redirect=%2Fadmin');
  });

  it('redirects authenticated non-admin users to the merchant dashboard', async () => {
    mockGetPlatformAdminContextAuth.mockResolvedValue({ status: 'forbidden' });

    await expect(
      AdminLayoutContent({
        children: <div>Admin content</div>,
      })
    ).rejects.toThrow('NEXT_REDIRECT:/dashboard');

    expect(mockRedirect).toHaveBeenCalledWith('/dashboard');
  });
});
