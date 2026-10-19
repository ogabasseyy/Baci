import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCreateNotificationPageClient = vi.fn(
  ({ canTargetSpecificMerchants }: { canTargetSpecificMerchants: boolean }) => (
    <div
      data-can-target-specific={canTargetSpecificMerchants}
      data-testid="notification-page-client"
    />
  )
);
const mockGetPlatformAdminAuthForPermission = vi.fn();
const mockRedirect = vi.fn((destination: string) => {
  throw new Error(`NEXT_REDIRECT:${destination}`);
});

vi.mock('./create-notification-page-client', () => ({
  CreateNotificationPageClient: (props: {
    canTargetSpecificMerchants: boolean;
  }) => mockCreateNotificationPageClient(props),
}));

vi.mock('next/navigation', () => ({
  redirect: (destination: string) => mockRedirect(destination),
}));

vi.mock('@/lib/platform-admin-auth', () => ({
  getPlatformAdminAuthForPermission: (...args: unknown[]) =>
    mockGetPlatformAdminAuthForPermission(...args),
}));

import CreateNotificationPage from './page';

describe('/admin/notifications/create page permissions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('withholds specific merchant targeting without merchants.read', async () => {
    mockGetPlatformAdminAuthForPermission.mockResolvedValue({
      context: {
        permissions: ['notifications.manage'],
        role: 'content',
      },
      status: 'authenticated',
      user: { email: 'admin@example.com', id: 'admin-1' },
    });

    render(await CreateNotificationPage());

    expect(mockGetPlatformAdminAuthForPermission).toHaveBeenCalledWith(
      'notifications.manage'
    );
    expect(mockCreateNotificationPageClient).toHaveBeenCalledWith({
      canTargetSpecificMerchants: false,
    });
    expect(screen.getByTestId('notification-page-client')).toHaveAttribute(
      'data-can-target-specific',
      'false'
    );
  });
});
