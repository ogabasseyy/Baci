import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { NotificationWithStats } from '@/types/notifications';
import { NotificationDeliveryStatus } from './notification-delivery-status';
import { getNotificationTargetLabel } from './notification-target-label';

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

describe('NotificationDeliveryStatus', () => {
  it('does not claim a redacted specific audience has zero merchants', () => {
    expect(
      getNotificationTargetLabel({
        ...notification,
        target_merchant_ids: [],
        target_type: 'specific',
      })
    ).toBe('Specific merchants');
  });

  it('reports a due pending notification as queued instead of sent', () => {
    render(
      <NotificationDeliveryStatus
        notification={{
          ...notification,
          scheduled_for: new Date(Date.now() - 60_000).toISOString(),
        }}
      />
    );

    expect(screen.getByText('Queued')).toBeInTheDocument();
  });

  it('renders worker lifecycle failures explicitly', () => {
    render(
      <NotificationDeliveryStatus
        notification={{ ...notification, delivery_state: 'failed' }}
      />
    );

    expect(screen.getByText('Failed')).toBeInTheDocument();
  });
});
