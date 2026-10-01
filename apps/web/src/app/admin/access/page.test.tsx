import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const mockAccess = vi.fn();
const mockRedirect = vi.fn();

vi.mock('@/lib/admin-platform-access-auth', () => ({
  getAdminPlatformAccessAuth: () => mockAccess(),
}));
vi.mock('next/navigation', () => ({
  redirect: (...args: unknown[]) => mockRedirect(...args),
}));
vi.mock('./access-management-client', () => ({
  AccessManagementClient: () => <div>Access management client</div>,
}));

import AdminAccessPage from './page';

describe('AdminAccessPage', () => {
  it('renders the management client for a roles.manage operator', async () => {
    mockAccess.mockResolvedValue({ status: 'authorized' });

    render(await AdminAccessPage());

    expect(screen.getByText('Access management client')).toBeInTheDocument();
  });

  it('redirects unauthenticated visitors to login', async () => {
    mockAccess.mockResolvedValue({ status: 'unauthenticated' });

    await AdminAccessPage();

    expect(mockRedirect).toHaveBeenCalledWith(
      '/login?redirect=%2Fadmin%2Faccess'
    );
  });
});
