import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { notificationActionUrl } from '@/lib/notification-action-url';
import type { ActiveBanner } from '@/types/notifications';

const mockUseNotifications = vi.fn();

vi.mock('@/hooks/use-notifications', () => ({
  useNotifications: () => mockUseNotifications(),
}));

import { NotificationBanner } from './notification-banner';

const banner: ActiveBanner = {
  action_label: 'Review orders',
  action_url: '/dashboard/orders',
  created_at: '2026-08-05T10:00:00.000Z',
  id: 'banner-1',
  message: 'Orders need attention.',
  notification_id: 'notification-1',
  notification_type: 'warning',
  priority: 'high',
  title: 'Action required',
};

describe('NotificationBanner', () => {
  beforeEach(() => {
    mockUseNotifications.mockReturnValue({
      activeBanners: [banner],
      dismissBanner: vi.fn(),
      isLoading: false,
    });
  });

  it('does not render an action for a persisted unsafe URL', () => {
    mockUseNotifications.mockReturnValue({
      activeBanners: [{ ...banner, action_url: 'javascript:alert(1)' }],
      dismissBanner: vi.fn(),
      isLoading: false,
    });

    render(<NotificationBanner />);

    expect(
      screen.queryByRole('button', { name: /review orders/i })
    ).not.toBeInTheDocument();
  });

  it('opens a validated action through the shared URL guard', async () => {
    const user = userEvent.setup();
    const open = vi.spyOn(notificationActionUrl, 'open').mockReturnValue(true);
    render(<NotificationBanner />);

    await user.click(screen.getByRole('button', { name: /review orders/i }));

    expect(open).toHaveBeenCalledWith('/dashboard/orders');
    open.mockRestore();
  });
});
