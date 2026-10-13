import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRefetch = vi.fn();

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('@/hooks/use-notifications', () => ({
  useNotifications: vi.fn(),
}));

import { useNotifications } from '@/hooks/use-notifications';
import NotificationsPage from './page';

describe('NotificationsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useNotifications).mockReturnValue({
      activeBanners: [],
      dismiss: vi.fn(),
      dismissBanner: vi.fn(),
      error: 'Notifications could not be loaded. Please try again.',
      hasMore: false,
      isLoading: false,
      loadMore: vi.fn(),
      markAllAsRead: vi.fn(),
      markAsRead: vi.fn(),
      notifications: [],
      refetch: mockRefetch,
      unreadCount: 0,
    });
  });

  it('shows a persistent error with retry instead of a healthy empty state', async () => {
    const user = userEvent.setup();
    render(<NotificationsPage />);

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Notifications could not load.'
    );
    expect(screen.queryByText('No notifications')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /try again/i }));
    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });

  it('announces loading while notification data is pending', () => {
    vi.mocked(useNotifications).mockReturnValue({
      activeBanners: [],
      dismiss: vi.fn(),
      dismissBanner: vi.fn(),
      error: null,
      hasMore: false,
      isLoading: true,
      loadMore: vi.fn(),
      markAllAsRead: vi.fn(),
      markAsRead: vi.fn(),
      notifications: [],
      refetch: vi.fn(),
      unreadCount: 0,
    });

    render(<NotificationsPage />);

    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByText('Loading notifications')).toBeInTheDocument();
  });

  it('offers mark-all only when unread notifications exist', async () => {
    const user = userEvent.setup();
    const markAllAsRead = vi.fn();
    vi.mocked(useNotifications).mockReturnValue({
      activeBanners: [],
      dismiss: vi.fn(),
      dismissBanner: vi.fn(),
      error: null,
      hasMore: false,
      isLoading: false,
      loadMore: vi.fn(),
      markAllAsRead,
      markAsRead: vi.fn(),
      notifications: [],
      refetch: vi.fn(),
      unreadCount: 2,
    });

    render(<NotificationsPage />);

    expect(
      screen.getByText('You have 2 unread notifications')
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /mark all read/i }));
    expect(markAllAsRead).toHaveBeenCalledTimes(1);
  });
});
