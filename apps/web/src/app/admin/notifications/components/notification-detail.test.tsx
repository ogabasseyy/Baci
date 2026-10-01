import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { NotificationWithStats } from '@/types/notifications';

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

import { NotificationDetail } from './notification-detail';

const notification: NotificationWithStats = {
  action_label: null,
  action_url: null,
  channels: ['in_app'],
  created_at: new Date(Date.now() - 60_000).toISOString(),
  created_by: 'admin-1',
  delivery_attempts: 0,
  delivery_last_error: null,
  delivery_state: 'pending',
  expires_at: null,
  id: 'notification-1',
  is_system: false,
  message: 'Dashboard maintenance',
  notification_type: 'info',
  priority: 'normal',
  scheduled_for: '2026-12-01T10:00:00.000Z',
  sent_at: null,
  stats: { read_rate: 50, total_dismissed: 1, total_read: 2, total_sent: 4 },
  target_merchant_ids: [],
  target_segment: null,
  target_type: 'all',
  template_id: null,
  title: 'Maintenance',
};

describe('NotificationDetail', () => {
  it('allows cancellation only while scheduled work is still mutable', async () => {
    const onDelete = vi.fn();
    const user = userEvent.setup();
    render(
      <NotificationDetail
        deliveries={[]}
        isDeleting={false}
        notification={notification}
        onDelete={onDelete}
      />
    );

    await user.click(screen.getByRole('button', { name: /cancel pending/i }));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Total Sent')).not.toBeInTheDocument();
  });

  it('shows retained delivery metrics and records after a notification is sent', () => {
    render(
      <NotificationDetail
        deliveries={[
          {
            business_name: 'Baci Store',
            created_at: notification.created_at,
            dismissed_at: null,
            id: 'delivery-1',
            merchant_id: 'merchant-1',
            read_at: notification.created_at,
          },
        ]}
        isDeleting={false}
        notification={{
          ...notification,
          delivery_state: 'sent',
          sent_at: '2026-08-05T12:00:00.000Z',
        }}
        onDelete={vi.fn()}
      />
    );

    expect(screen.getByText('Total Sent')).toBeInTheDocument();
    expect(screen.getByText('50%')).toBeInTheDocument();
    expect(screen.getByText('Baci Store')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /cancel pending/i })
    ).not.toBeInTheDocument();
  });
});
