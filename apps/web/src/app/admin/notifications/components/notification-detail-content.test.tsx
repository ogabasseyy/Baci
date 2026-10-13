import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { NotificationWithStats } from '@/types/notifications';
import { NotificationDetailContent } from './notification-detail-content';

const notification: NotificationWithStats = {
  id: 'notification-1',
  template_id: null,
  title: 'Maintenance window',
  message: 'Baci will run maintenance tonight.',
  notification_type: 'info',
  priority: 'normal',
  target_type: 'all',
  target_merchant_ids: [],
  target_segment: null,
  channels: ['in_app'],
  action_url: null,
  action_label: null,
  scheduled_for: null,
  expires_at: null,
  created_by: 'admin-1',
  created_at: '2026-08-05T10:00:00.000Z',
  delivery_attempts: 0,
  delivery_last_error: null,
  delivery_state: 'pending',
  sent_at: null,
  is_system: false,
  stats: { total_sent: 0, total_read: 0, total_dismissed: 0, read_rate: 0 },
};

describe('NotificationDetailContent', () => {
  it('does not render an unsafe action URL persisted before validation', () => {
    render(
      <NotificationDetailContent
        notification={{ ...notification, action_url: 'javascript:alert(1)' }}
      />
    );

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByText('Action URL')).not.toBeInTheDocument();
  });

  it('renders a safe relative action URL as a no-opener link', () => {
    render(
      <NotificationDetailContent
        notification={{ ...notification, action_url: '/dashboard/orders' }}
      />
    );

    expect(
      screen.getByRole('link', { name: '/dashboard/orders' })
    ).toHaveAttribute('href', '/dashboard/orders');
  });
});
