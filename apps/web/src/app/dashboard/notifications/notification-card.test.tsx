import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { MerchantNotificationWithDetails } from '@/types/notifications';
import { NotificationCard } from './notification-card';

const { openAction } = vi.hoisted(() => ({ openAction: vi.fn() }));

vi.mock('@/lib/notification-action-url', () => ({
  notificationActionUrl: {
    open: (...args: unknown[]) => openAction(...args),
    parse: (value: string | null | undefined) => value || null,
  },
}));

const notification = {
  created_at: '2026-08-05T10:00:00.000Z',
  id: 'recipient-1',
  notification: {
    action_label: 'View details',
    action_url: '/dashboard/orders',
    message: 'Your order needs attention.',
    notification_type: 'info',
    title: 'Order update',
  },
  read_at: null,
} as MerchantNotificationWithDetails;

describe('NotificationCard', () => {
  it('keeps action controls outside the card button and opens only validated actions', async () => {
    const user = userEvent.setup();
    const markAsRead = vi.fn();
    render(
      <NotificationCard
        notification={notification}
        onDismiss={vi.fn()}
        onMarkAsRead={markAsRead}
      />
    );

    const cardButton = screen.getByRole('button', {
      name: /open notification: order update/i,
    });
    expect(within(cardButton).queryByRole('button')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /view details/i }));
    expect(markAsRead).toHaveBeenCalledTimes(1);
    expect(openAction).toHaveBeenCalledWith('/dashboard/orders');
  });
});
